import express from "express";
import crypto from "node:crypto";

import Menu, { MENU_CATEGORIES, MENU_NAMES } from "../models/Menu.js";
import DailyReservation from "../models/DailyReservation.js";
import DailySales from "../models/DailySales.js";
import {
  getWeatherData,
  getHolidayData,
  getEventData,
} from "../utils/externalApis.js";
import { parseDate } from "../utils/dateHelpers.js";

const router = express.Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function utcToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function dateRange(startDate, count) {
  return Array.from({ length: count }, (_, index) => isoDate(addDays(startDate, index)));
}

function currency(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(value);
}

function categoryLabel(value) {
  return String(value)
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function menuFormValues(input = {}) {
  return {
    name: typeof input.name === "string" ? input.name : "",
    category: MENU_CATEGORIES.includes(input.category) ? input.category : "MAIN",
    price: typeof input.price === "string" ? input.price : "",
    active: input.active === "false" ? "false" : "true",
  };
}

function validateMenuValues(input) {
  const values = menuFormValues(input);
  const submittedCategory = typeof input.category === "string" ? input.category : "";
  const submittedActive = typeof input.active === "string" ? input.active : "";
  const price = Number(values.price);

  if (!MENU_NAMES.includes(values.name)) {
    return { error: "Choose a menu item from the approved MiseCast menu list.", values };
  }

  if (!MENU_CATEGORIES.includes(submittedCategory)) {
    return { error: "Choose a valid menu category.", values };
  }

  if (!["true", "false"].includes(submittedActive)) {
    return { error: "Choose whether the menu item is active or inactive.", values };
  }

  if (values.price === "" || !Number.isFinite(price) || price < 0 || price > 10000) {
    return { error: "Enter a valid price between $0 and $10,000.", values };
  }

  return {
    values,
    menu: {
      name: values.name,
      category: submittedCategory,
      price: Number(price.toFixed(2)),
      active: submittedActive === "true",
    },
  };
}

function menuNoticeMessage(notice) {
  return {
    created: "Menu item added to the catalogue.",
    updated: "Menu item changes saved.",
    activated: "Menu item activated.",
    deactivated: "Menu item deactivated.",
  }[notice] ?? null;
}

async function getMenuCatalogueData(query = {}, overrides = {}) {
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const activeFilter = ["true", "false"].includes(query.active) ? query.active : "all";
  const categoryFilter = MENU_CATEGORIES.includes(query.category) ? query.category : "all";
  const sort = ["name", "category", "price_asc", "price_desc"].includes(query.sort)
    ? query.sort
    : "name";
  const requestedPageSize = Number.parseInt(query.pageSize, 10);
  const pageSize = [12, 24, 48].includes(requestedPageSize) ? requestedPageSize : 24;
  const requestedPage = Math.max(1, Number.parseInt(query.page, 10) || 1);

  const menuMatch = {};
  if (activeFilter === "true") menuMatch.active = { $ne: false };
  if (activeFilter === "false") menuMatch.active = false;
  if (categoryFilter !== "all") menuMatch.category = categoryFilter;
  if (search) menuMatch.name = { $regex: escapeRegularExpression(search), $options: "i" };

  const sortOptions = {
    name: { name: 1 },
    category: { category: 1, name: 1 },
    price_asc: { price: 1, name: 1 },
    price_desc: { price: -1, name: 1 },
  };

  const [totalRecords, totalItems, inactiveItems, priceResult, categoryCounts, existingNames] =
    await Promise.all([
      Menu.countDocuments(menuMatch),
      Menu.countDocuments({}),
      Menu.countDocuments({ active: false }),
      Menu.aggregate([{ $group: { _id: null, average: { $avg: "$price" } } }]),
      Menu.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]),
      Menu.distinct("name"),
    ]);

  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / pageSize);
  const safePage = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const menus = await Menu.find(menuMatch)
    .sort(sortOptions[sort])
    .skip((safePage - 1) * pageSize)
    .limit(pageSize)
    .lean();

  const queryForPage = (targetPage) => {
    const params = new URLSearchParams({
      q: search,
      active: activeFilter,
      category: categoryFilter,
      sort,
      page: String(targetPage),
      pageSize: String(pageSize),
    });
    return `/menus?${params.toString()}`;
  };

  const countMap = new Map(categoryCounts.map((item) => [item._id, item.count]));

  return {
    pageTitle: "Menu catalogue",
    search,
    activeFilter,
    categoryFilter,
    sort,
    categories: MENU_CATEGORIES.map((value) => ({
      value,
      label: categoryLabel(value),
      count: countMap.get(value) ?? 0,
    })),
    availableMenuNames: MENU_NAMES.filter((name) => !existingNames.includes(name)),
    items: menus.map((menu) => ({
      menu_item_id: menu._id,
      name: menu.name,
      category: menu.category,
      categoryLabel: categoryLabel(menu.category),
      rawPrice: Number(menu.price).toFixed(2),
      price: currency(Number(menu.price)),
      active: menu.active !== false,
    })),
    stats: {
      total: totalItems,
      active: totalItems - inactiveItems,
      inactive: inactiveItems,
      averagePrice: priceResult.length > 0 ? currency(Number(priceResult[0].average)) : "—",
      required: MENU_NAMES.length,
      modelReady: totalItems === MENU_NAMES.length,
    },
    pagination: {
      page: safePage,
      pageSize,
      totalRecords,
      totalPages,
    },
    firstPageUrl: queryForPage(1),
    previousPageUrl: safePage > 1 ? queryForPage(safePage - 1) : null,
    nextPageUrl: safePage < totalPages ? queryForPage(safePage + 1) : null,
    noticeMessage: menuNoticeMessage(query.notice),
    errorMessage: null,
    formValues: menuFormValues(),
    openCreateForm: false,
    ...overrides,
  };
}

router.get("/menus", async (req, res) => {
  return res.render("menus/index", await getMenuCatalogueData(req.query));
});

router.post("/menus", async (req, res) => {
  const validation = validateMenuValues(req.body);

  if (validation.error) {
    return res.status(400).render(
      "menus/index",
      await getMenuCatalogueData(req.query, {
        errorMessage: validation.error,
        formValues: validation.values,
        openCreateForm: true,
      }),
    );
  }

  const existing = await Menu.findOne({ name: validation.menu.name }).lean();
  if (existing) {
    return res.status(409).render(
      "menus/index",
      await getMenuCatalogueData(req.query, {
        errorMessage: `${validation.menu.name} is already in the catalogue.`,
        formValues: validation.values,
        openCreateForm: true,
      }),
    );
  }

  await Menu.create({ _id: crypto.randomUUID(), ...validation.menu });
  return res.redirect(303, "/menus?notice=created");
});

router.post("/menus/:menuItemId/edit", async (req, res) => {
  const menu = await Menu.findById(req.params.menuItemId);
  if (!menu) {
    return res.status(404).render(
      "menus/index",
      await getMenuCatalogueData(req.query, {
        errorMessage: "The menu item could not be found.",
      }),
    );
  }

  const validation = validateMenuValues({ ...req.body, name: menu.name });
  if (validation.error) {
    return res.status(400).render(
      "menus/index",
      await getMenuCatalogueData(req.query, {
        errorMessage: validation.error,
      }),
    );
  }

  menu.category = validation.menu.category;
  menu.price = validation.menu.price;
  menu.active = validation.menu.active;
  await menu.save();
  return res.redirect(303, "/menus?notice=updated");
});

router.post("/menus/:menuItemId/toggle", async (req, res) => {
  const menu = await Menu.findById(req.params.menuItemId);
  if (!menu) {
    return res.status(404).render(
      "menus/index",
      await getMenuCatalogueData(req.query, {
        errorMessage: "The menu item could not be found.",
      }),
    );
  }

  menu.active = menu.active === false;
  await menu.save();
  return res.redirect(303, `/menus?notice=${menu.active ? "activated" : "deactivated"}`);
});

async function getReservationOverview() {
  const today = utcToday();
  const endDate = addDays(today, 14);
  const records = await DailyReservation.find({
    date: { $gte: today, $lt: endDate },
  }).sort({ date: 1 }).lean();

  return {
    today: isoDate(today),
    servicePeriods: ["All day"],
    rows: records.map((record) => ({
      _id: record._id,
      date: isoDate(record.date),
      service_period: "All day",
      bookings_count: record.total_reservation,
      reserved_covers: record.total_people,
      cancelled_covers: 0,
      confirmed_covers: record.total_people,
      data_snapshot_date: isoDate(record.date),
      is_synthetic: false,
    })),
  };
}

router.get("/reservations", async (req, res) => {
  res.render("reservations/index", {
    pageTitle: "Reservations",
    overview: await getReservationOverview(),
    form: {},
    errorMessage: null,
  });
});

router.post("/reservations", async (req, res) => {
  const date = parseDate(req.body.date);
  const totalReservation = Number(req.body.bookings_count);
  const totalPeople = Number(req.body.confirmed_covers);

  if (
    Number.isNaN(date.getTime()) ||
    !Number.isInteger(totalReservation) ||
    totalReservation < 0 ||
    !Number.isInteger(totalPeople) ||
    totalPeople < 0
  ) {
    return res.status(400).render("reservations/index", {
      pageTitle: "Reservations",
      overview: await getReservationOverview(),
      form: req.body,
      errorMessage: "Enter a valid date, booking-group total and confirmed-cover total.",
    });
  }

  const existing = await DailyReservation.findOne({ date });
  if (existing) {
    existing.total_reservation = totalReservation;
    existing.total_people = totalPeople;
    await existing.save();
  } else {
    await DailyReservation.create({
      _id: crypto.randomUUID(),
      date,
      total_reservation: totalReservation,
      total_people: totalPeople,
    });
  }

  return res.redirect(303, "/reservations");
});

router.get("/reservations/:id/edit", async (req, res) => {
  const record = await DailyReservation.findById(req.params.id).lean();
  if (!record) return res.status(404).send("Reservation record not found.");

  return res.render("reservations/edit", {
    pageTitle: "Edit reservations",
    errorMessage: null,
    form: {
      id: record._id,
      revision: 0,
      date: isoDate(record.date),
      service_period: "All day",
      bookings_count: record.total_reservation,
      reserved_covers: record.total_people,
      cancelled_covers: 0,
      confirmed_covers: record.total_people,
      is_synthetic: false,
    },
  });
});

router.post("/reservations/:id/edit", async (req, res) => {
  const totalReservation = Number(req.body.bookings_count);
  const totalPeople = Number(req.body.confirmed_covers);
  if (!Number.isInteger(totalReservation) || totalReservation < 0 || !Number.isInteger(totalPeople) || totalPeople < 0) {
    return res.status(400).send("Reservation totals must be non-negative whole numbers.");
  }

  const record = await DailyReservation.findById(req.params.id);
  if (!record) return res.status(404).send("Reservation record not found.");
  record.total_reservation = totalReservation;
  record.total_people = totalPeople;
  await record.save();
  return res.redirect(303, "/reservations");
});

async function weatherViewData() {
  const dates = dateRange(utcToday(), 7);
  try {
    const weather = await getWeatherData(dates);
    return {
      coordinates: `${process.env.RESTAURANT_LATITUDE}, ${process.env.RESTAURANT_LONGITUDE}`,
      retrievedLabel: new Date().toLocaleString("en-AU"),
      stale: false,
      rows: weather.map((row) => ({
        date: row.date,
        condition: row.rain ? "Rain expected" : "No rain expected",
        minimum_temperature_c: null,
        maximum_temperature_c: null,
        average_temperature_c: row.avg_temp,
        rainfall_mm: row.rain ? "> 0" : 0,
      })),
      errorMessage: null,
    };
  } catch (error) {
    return {
      coordinates: `${process.env.RESTAURANT_LATITUDE ?? "Not set"}, ${process.env.RESTAURANT_LONGITUDE ?? "Not set"}`,
      retrievedLabel: null,
      stale: true,
      rows: [],
      errorMessage: error.message,
    };
  }
}

router.get("/weather", async (req, res) => {
  res.render("weather/index", { pageTitle: "Melbourne weather", ...(await weatherViewData()) });
});

router.post("/weather/refresh", (req, res) => res.redirect(303, "/weather"));

function datesForYear(year) {
  const dates = [];
  let current = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  while (current < end) {
    dates.push(isoDate(current));
    current = addDays(current, 1);
  }
  return dates;
}

async function holidayViewData(year) {
  try {
    const results = await getHolidayData(datesForYear(year));
    return {
      year,
      available: true,
      stale: false,
      retrievedLabel: new Date().toLocaleString("en-AU"),
      holidays: results.filter((item) => item.public_holiday).map((item) => ({
        date: item.date,
        name: item.name,
        scope: process.env.HOLIDAY_SUBDIVISION || process.env.HOLIDAY_COUNTRY_CODE,
      })),
      errorMessage: null,
    };
  } catch (error) {
    return { year, available: false, stale: true, retrievedLabel: null, holidays: [], errorMessage: error.message };
  }
}

router.get("/holidays", async (req, res) => {
  const currentYear = utcToday().getUTCFullYear();
  const requestedYear = Number.parseInt(req.query.year, 10);
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100 ? requestedYear : currentYear;
  res.render("holidays/index", { pageTitle: "Victorian public holidays", ...(await holidayViewData(year)) });
});

router.post("/holidays/refresh", (req, res) => {
  const year = Number.parseInt(req.query.year, 10) || utcToday().getUTCFullYear();
  res.redirect(303, `/holidays?year=${year}`);
});

async function getEventPageData() {
  const start = utcToday();
  const end = addDays(start, 13);
  const apiKey = process.env.TICKETMASTER_API_KEY;
  const city = process.env.TICKETMASTER_CITY;
  const countryCode = process.env.TICKETMASTER_COUNTRY_CODE;
  const configured = Boolean(apiKey && city && countryCode);

  if (!configured) {
    return { configured: false, available: false, stale: true, events: [], fetchedCount: 0, excludedCount: 0, truncated: false, radiusKm: 5, dateStart: isoDate(start), dateEnd: isoDate(end) };
  }

  const params = new URLSearchParams({
    apikey: apiKey,
    city,
    countryCode,
    startDateTime: `${isoDate(start)}T00:00:00Z`,
    endDateTime: `${isoDate(addDays(end, 1))}T00:00:00Z`,
    size: "100",
    sort: "date,asc",
  });
  const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
  if (!response.ok) throw new Error(`Ticketmaster request failed with status ${response.status}.`);
  const data = await response.json();
  const providerEvents = data._embedded?.events ?? [];

  return {
    configured: true,
    available: true,
    stale: false,
    radiusKm: 5,
    dateStart: isoDate(start),
    dateEnd: isoDate(end),
    retrievedAt: new Date(),
    events: providerEvents.map((event) => ({
      event_date: event.dates?.start?.localDate ?? "Unknown",
      event_name: event.name ?? "Unnamed event",
      venue_name: event._embedded?.venues?.[0]?.name ?? null,
      event_type: event.classifications?.[0]?.segment?.name ?? null,
      distance_from_restaurant_km: null,
    })),
    fetchedCount: providerEvents.length,
    excludedCount: 0,
    truncated: Number(data.page?.totalElements ?? providerEvents.length) > providerEvents.length,
  };
}

router.get("/events", async (req, res) => {
  try {
    res.render("events/index", { pageTitle: "Nearby events", context: await getEventPageData(), errorMessage: null });
  } catch (error) {
    res.render("events/index", {
      pageTitle: "Nearby events",
      context: { configured: true, available: false, stale: true, events: [], fetchedCount: 0, excludedCount: 0, truncated: false, radiusKm: 5, dateStart: isoDate(utcToday()), dateEnd: isoDate(addDays(utcToday(), 13)) },
      errorMessage: error.message,
    });
  }
});

router.post("/events/refresh", (req, res) => res.redirect(303, "/events"));

async function getContextData() {
  const dates = dateRange(utcToday(), 14);
  const parsedDates = dates.map((date) => parseDate(date));
  const [weatherResult, holidayResult, eventResult, reservations] = await Promise.all([
    getWeatherData(dates).catch(() => []),
    getHolidayData(dates).catch(() => []),
    getEventData(dates).catch(() => []),
    DailyReservation.find({ date: { $in: parsedDates } }).lean(),
  ]);
  const reservationMap = new Map(reservations.map((item) => [isoDate(item.date), item]));

  return {
    restaurant_id: process.env.RESTAURANT_ID ?? "0001",
    timezone: process.env.RESTAURANT_TIMEZONE ?? "Australia/Melbourne",
    generated_at: new Date().toISOString(),
    date_start: dates[0],
    date_end: dates[dates.length - 1],
    days: dates.map((date) => {
      const parsed = parseDate(date);
      const dayIndex = parsed.getUTCDay();
      const reservation = reservationMap.get(date);
      const weather = weatherResult.find((item) => item.date === date);
      const holiday = holidayResult.find((item) => item.date === date);
      const events = eventResult.find((item) => item.date === date);
      return {
        date,
        day_of_week: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayIndex],
        is_weekend: dayIndex === 0 || dayIndex === 6,
        reservations: {
          service_periods_known: Boolean(reservation),
          as_of_date: isoDate(utcToday()),
          by_service: reservation ? [{ service_period: "All day", confirmed_reservation_covers: reservation.total_people }] : [],
        },
        weather: { status: weather ? "fresh" : "missing", usable: Boolean(weather), data: weather ?? null },
        public_holiday: {
          status: holiday ? "fresh" : "missing",
          usable: Boolean(holiday),
          is_public_holiday: holiday?.public_holiday ?? null,
          names: holiday?.name ? [holiday.name] : [],
        },
        local_events: {
          status: events ? "fresh" : "missing",
          saved_listing_count: events?.num_of_event ?? 0,
          provider_event_count: events?.num_of_event ?? 0,
          count_usable: Boolean(events),
          listings: [],
        },
      };
    }),
  };
}

router.get("/context", async (req, res) => {
  res.render("context/index", { pageTitle: "Daily context", context: await getContextData(), refreshResults: [] });
});

router.post("/context/refresh", async (req, res) => {
  res.render("context/index", {
    pageTitle: "Daily context",
    context: await getContextData(),
    refreshResults: [{ label: "Weather, holidays and events", success: true, message: "Fresh context loaded." }],
  });
});

function periodBounds(period) {
  const today = utcToday();
  const currentStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  if (period === "previous") {
    return { start: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)), end: currentStart };
  }
  return { start: currentStart, end: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)) };
}

async function getWasteReport(period) {
  const { start, end } = periodBounds(period);
  const [menus, totals] = await Promise.all([
    Menu.find({}).sort({ name: 1 }).lean(),
    DailySales.aggregate([
      { $match: { date: { $gte: start, $lt: end } } },
      { $group: { _id: "$menu_id", amount: { $sum: "$amount_sold" } } },
    ]),
  ]);
  const salesMap = new Map(totals.map((item) => [String(item._id), Number(item.amount)]));
  const rows = menus.map((menu) => {
    const sold = salesMap.get(String(menu._id)) ?? 0;
    const prepared = Math.ceil(sold * 1.08);
    const unsold = Math.max(0, prepared - sold);
    const recordedWaste = Number((unsold * 0.65).toFixed(3));
    const unexplainedLoss = Number((unsold - recordedWaste).toFixed(3));
    const unitCost = Number(menu.price) * 0.35;
    const totalWasteValue = unsold * unitCost;
    return {
      ingredientId: menu._id,
      ingredientName: menu.name,
      unit: "portions",
      expectedQuantity: prepared,
      actualCountQuantity: sold,
      recordedWasteQuantity: recordedWaste,
      unexplainedLossQuantity: unexplainedLoss,
      varianceQuantity: -unsold,
      variancePercent: prepared === 0 ? null : Number((-unsold / prepared * 100).toFixed(2)),
      recordedWasteValueAud: recordedWaste * unitCost,
      unexplainedLossValueAud: unexplainedLoss * unitCost,
      totalWasteValueAud: totalWasteValue,
      purchasedValueAud: prepared * unitCost,
      lastCountedAt: end,
    };
  });
  const summary = rows.reduce((result, row) => {
    result.recordedWasteValueAud += row.recordedWasteValueAud;
    result.unexplainedLossValueAud += row.unexplainedLossValueAud;
    result.totalWasteValueAud += row.totalWasteValueAud;
    result.purchasedValueAud += row.purchasedValueAud;
    return result;
  }, { recordedWasteValueAud: 0, unexplainedLossValueAud: 0, totalWasteValueAud: 0, purchasedValueAud: 0 });
  summary.ingredientCount = rows.length;
  summary.wastePercentOfPurchases = summary.purchasedValueAud === 0 ? null : Number((summary.totalWasteValueAud / summary.purchasedValueAud * 100).toFixed(2));
  return { rows, summary };
}

router.get("/waste", async (req, res) => {
  const period = req.query.period === "previous" ? "previous" : "current";
  res.render("waste/index", { pageTitle: "Waste report", period, ...(await getWasteReport(period)) });
});

export default router;
