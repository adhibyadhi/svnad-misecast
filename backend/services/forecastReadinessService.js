import { HistoricalSale, MenuItem, MenuVariant } from "../models/index.js";
import { restaurant } from "../config/restaurant.js";
import { addBusinessDays, getBusinessDate } from "../utils/businessDate.js";

export async function getForecastReadiness() {
  const today = getBusinessDate(restaurant.timezone);
  const historyStart = addBusinessDays(today, -28);

  // Exclude today because its service periods may still be incomplete.
  const historyFilter = {
    restaurant_id: restaurant.restaurantId,
    date: {
      $gte: historyStart,
      $lt: today,
    },
  };

  const [activeParents, eligibleVariants, salesSummary, historyGroups] =
    await Promise.all([
      MenuItem.find({ active: true })
        .select({ _id: 0, menu_item_id: 1 })
        .lean(),

      MenuVariant.find({
        active: true,
        demand_model_training_eligible: true,
      })
        .select({
          _id: 0,
          menu_variant_id: 1,
          menu_item_id: 1,
          menu_variant_name: 1,
          portion_size: 1,
          category: 1,
        })
        .sort({ menu_variant_id: 1 })
        .lean(),

      HistoricalSale.aggregate([
        {
          $match: {
            restaurant_id: restaurant.restaurantId,
          },
        },
        {
          $group: {
            _id: null,
            record_count: { $sum: 1 },
            first_date: { $min: "$date" },
            last_date: { $max: "$date" },
            synthetic_record_count: {
              $sum: {
                $cond: [{ $eq: ["$is_synthetic", true] }, 1, 0],
              },
            },
          },
        },
        {
          $project: { _id: 0 },
        },
      ]),

      HistoricalSale.aggregate([
        { $match: historyFilter },
        {
          $group: {
            _id: {
              menu_variant_id: "$menu_variant_id",
              service_period: "$service_period",
            },
            dates_with_records: { $addToSet: "$date" },
            channels_present: { $addToSet: "$channel" },
            record_count: { $sum: 1 },
            missing_quantity_count: {
              $sum: {
                $cond: [
                  {
                    $eq: [{ $ifNull: ["$quantity_sold", null] }, null],
                  },
                  1,
                  0,
                ],
              },
            },
            synthetic_record_count: {
              $sum: {
                $cond: [{ $eq: ["$is_synthetic", true] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            menu_variant_id: "$_id.menu_variant_id",
            service_period: "$_id.service_period",
            dates_with_records: 1,
            channels_present: 1,
            record_count: 1,
            missing_quantity_count: 1,
            synthetic_record_count: 1,
          },
        },
        {
          $sort: {
            menu_variant_id: 1,
            service_period: 1,
          },
        },
      ]),
    ]);

  const activeParentIds = new Set(
    activeParents.map((item) => item.menu_item_id),
  );

  const historyByVariant = new Map();

  for (const group of historyGroups) {
    const existing = historyByVariant.get(group.menu_variant_id) ?? [];

    existing.push({
      service_period: group.service_period,
      dates_with_records: group.dates_with_records.sort(),
      days_with_records: group.dates_with_records.length,
      channels_present: group.channels_present,
      record_count: group.record_count,
      missing_quantity_count: group.missing_quantity_count,
      synthetic_record_count: group.synthetic_record_count,
    });

    historyByVariant.set(group.menu_variant_id, existing);
  }

  const variants = eligibleVariants
    .filter((variant) => activeParentIds.has(variant.menu_item_id))
    .map((variant) => {
      const history = historyByVariant.get(variant.menu_variant_id) ?? [];

      return {
        ...variant,
        has_recent_records: history.length > 0,
        history_by_service: history,
      };
    });

  return {
    restaurant_id: restaurant.restaurantId,
    timezone: restaurant.timezone,
    generated_at: new Date().toISOString(),

    history_window: {
      date_start: historyStart,
      date_end: addBusinessDays(today, -1),
      calendar_days: 28,
    },

    all_imported_sales: salesSummary[0] ?? {
      record_count: 0,
      first_date: null,
      last_date: null,
      synthetic_record_count: 0,
    },

    eligible_variant_count: variants.length,
    variants_with_recent_records: variants.filter(
      (variant) => variant.has_recent_records,
    ).length,
    variants_without_recent_records: variants.filter(
      (variant) => !variant.has_recent_records,
    ).length,

    model_contract_verified: false,
    can_generate_model_predictions: false,

    limitations: [
      "Dates with records do not prove that every channel or service was fully imported.",
      "Missing sales records are not treated as zero sales.",
      "Training eligibility does not prove that the trained model supports a variant.",
      "The executable model and preprocessing contract have not been verified.",
    ],

    variants,
  };
}
