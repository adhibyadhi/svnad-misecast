# utils/order_optimization.py
"""
Section 4.3: Order Optimization -- rule-based, not ML.

Classic reorder-point / order-up-to-level logic:
    reorder_point = avg_daily_demand * lead_time_days + safety_stock
    target_level  = reorder_point + avg_daily_demand * review_period_days
As soon as projected usable stock drops to the reorder point, it's time to
order enough to bring it back up to the target level, rounded to whole packs
and respecting the supplier's minimum order size.
"""
import math
import pandas as pd


def explode_ingredient_demand(forecast, menu_recipes, quantity_col="p50"):
    eligible = menu_recipes[menu_recipes["inventory_consumption_eligible"].astype(str).str.lower() == "true"]
    merged = forecast[["date", "service_period", "menu_variant_id", quantity_col]].merge(
        eligible[["menu_variant_id", "ingredient_id", "ingredient_name", "effective_quantity_per_portion", "unit"]],
        on="menu_variant_id", how="inner",
    )
    merged["ingredient_demand"] = merged[quantity_col] * merged["effective_quantity_per_portion"]
    return (merged.groupby(["date", "ingredient_id", "ingredient_name", "unit"], as_index=False)
                  .agg(ingredient_demand=("ingredient_demand", "sum")))


def usable_stock_by_date(batches, dates):
    dates = pd.Series(sorted(pd.to_datetime(dates).unique()))
    rows = []
    for d in dates:
        usable = batches[batches["expiry_date"] >= d]
        rows.append(usable.groupby("ingredient_id")["quantity_remaining"].sum().rename(d))
    return pd.concat(rows, axis=1)


def build_order_recommendations(forecast, menu_recipes, batches, current_inventory, suppliers,
                                 quantity_col="p50", review_period_days=7):
    daily_demand = explode_ingredient_demand(forecast, menu_recipes, quantity_col)
    dates = sorted(daily_demand["date"].unique())
    stock_by_date = usable_stock_by_date(batches, dates)

    demand_pivot = (daily_demand.pivot(index="ingredient_id", columns="date", values="ingredient_demand")
                                 .fillna(0.0).reindex(columns=dates, fill_value=0.0))
    avg_daily_demand = demand_pivot.mean(axis=1)

    supplier_primary = (suppliers[suppliers["is_primary_supplier"]]
                         .drop_duplicates("ingredient_id").set_index("ingredient_id"))
    safety_stock = current_inventory.set_index("ingredient_id")["safety_stock_quantity"]

    all_ingredients = sorted(set(demand_pivot.index) | set(stock_by_date.index))
    demand_pivot = demand_pivot.reindex(all_ingredients, fill_value=0.0)
    stock_by_date = stock_by_date.reindex(all_ingredients)

    results = []
    for ing in all_ingredients:
        if ing not in supplier_primary.index:
            continue  # no supplier on file -- can't recommend an order
        sup = supplier_primary.loc[ing]
        lead_time = float(sup["lead_time_days"])
        pack_size = float(sup["pack_size"])
        min_order_packs = int(sup["minimum_order_packs"])
        pack_cost = float(sup["pack_cost_aud"])
        delivery_fee = float(sup["delivery_fee_aud"])
        free_delivery_threshold = float(sup["free_delivery_threshold_aud"])

        daily_rate = float(avg_daily_demand.get(ing, 0.0))
        ss = float(safety_stock.get(ing, 0.0))
        reorder_point = daily_rate * lead_time + ss
        target_level = reorder_point + daily_rate * review_period_days

        remaining = None
        reorder_trigger_date = None
        for d in dates:
            usable_today = stock_by_date.loc[ing, d]
            usable_today = 0.0 if pd.isna(usable_today) else usable_today
            remaining = usable_today if remaining is None else min(remaining, usable_today)
            if remaining <= reorder_point and reorder_trigger_date is None:
                reorder_trigger_date = d
            remaining -= demand_pivot.loc[ing, d]

        if reorder_trigger_date is None:
            continue  # stays comfortably above the reorder point for the whole window

        order_quantity_needed = max(0.0, target_level - reorder_point)
        order_packs = max(min_order_packs, math.ceil(order_quantity_needed / pack_size)) if pack_size else min_order_packs
        order_quantity = order_packs * pack_size
        goods_cost = order_packs * pack_cost
        total_cost = goods_cost if goods_cost >= free_delivery_threshold else goods_cost + delivery_fee

        days_until_order_by = (reorder_trigger_date - dates[0]).days
        urgency = "Order now" if days_until_order_by <= 0 else ("Urgent" if days_until_order_by <= 2 else "Upcoming")

        results.append({
            "ingredient_id": ing,
            "order_by_date": reorder_trigger_date,
            "days_until_order_by": days_until_order_by,
            "urgency": urgency,
            "recommended_order_quantity": order_quantity,
            "unit": sup["unit"],
            "order_packs": order_packs,
            "estimated_cost_aud": round(total_cost, 2),
            "supplier_id": sup["supplier_id"],
            "supplier_name": sup["supplier_name"],
            "lead_time_days": lead_time,
        })
    return pd.DataFrame(results)