"""Transforms our pipeline's output into the exact schema backend/models/*.js
expects, ready for backend's own POST /api/imports/:entityName."""
import uuid
import math
import pandas as pd
import numpy as np
from utils import order_optimization as oo

MODEL_VERSION = "misecast-demand-p50p90-v1"
IS_SYNTHETIC = True


def _fmt_date(d):
    return None if pd.isna(d) else pd.Timestamp(d).strftime("%Y-%m-%d")

def _fmt_money(x, ndigits=2):
    return None if pd.isna(x) else round(float(x), ndigits)

def _fmt_num(x):
    return None if pd.isna(x) else float(x)

def _fmt_int(x):
    return None if pd.isna(x) else int(round(float(x)))

def _new_id(prefix):
    return f"{prefix}-{uuid.uuid4()}"


def build_demand_forecast_export(forecast, menu_variants, menu_items, forecast_generated_date,
                                  model_version=MODEL_VERSION):
    variant_lookup = menu_variants.set_index("menu_variant_id")
    item_name_lookup = menu_items.set_index("menu_item_id")["menu_item_name_clean"]
    rows = []
    for _, r in forecast.iterrows():
        variant = variant_lookup.loc[r["menu_variant_id"]]
        rows.append({
            "forecast_id": _new_id("FC"),
            "forecast_generated_date": _fmt_date(forecast_generated_date),
            "forecast_date": _fmt_date(r["date"]),
            "forecast_horizon_days": (pd.Timestamp(r["date"]) - pd.Timestamp(forecast_generated_date)).days,
            "service_period": r["service_period"],
            "menu_item_id": r["menu_item_id"],
            "menu_variant_id": r["menu_variant_id"],
            "menu_item_name": item_name_lookup.get(r["menu_item_id"]),
            "portion_size": variant.get("portion_size"),
            "category": variant.get("category"),
            "baseline_portions": _fmt_num(r.get("rolling_matching_weekday_avg")),
            "predicted_portions": _fmt_num(r["p50"]),
            "lower_bound_portions": None,      # no p10 model trained -- honestly unsupported
            "upper_bound_portions": _fmt_num(r["p90"]),
            "forecast_confidence_pct": None,   # unsupported, per model-contract.md
            "confirmed_reservation_covers": _fmt_int(r.get("reserved_covers")),
            "weather_condition": None,         # our feature table only carries numeric weather fields
            "special_occasion": None,          # our feature table only carries the numeric factor
            "event_types": None,               # our feature table only carries a numeric event_proximity score
            "key_demand_drivers": None,        # unsupported, per model-contract.md
            "predicted_revenue_aud": _fmt_money(r.get("expected_revenue_p50")),
            "model_version": model_version,
            "is_synthetic": IS_SYNTHETIC,
        })
        
    return pd.DataFrame(rows)


def build_runout_predictions_export(forecast, menu_recipes, batches, current_inventory,
                                     ingredient_master, waste, quantity_col="p50"):
    daily_demand = oo.explode_ingredient_demand(forecast, menu_recipes, quantity_col)
    dates = sorted(daily_demand["date"].unique())
    is_full_ten_day = len(dates) == 10
    stock_by_date = oo.usable_stock_by_date(batches, dates)
    demand_pivot = (daily_demand.pivot(index="ingredient_id", columns="date", values="ingredient_demand")
                                 .fillna(0.0).reindex(columns=dates, fill_value=0.0))

    inv = current_inventory.set_index("ingredient_id")
    im = ingredient_master.set_index("ingredient_id")
    waste_by_ingredient = waste.groupby("ingredient_id")["quantity_wasted"].sum()

    all_ingredients = sorted(set(demand_pivot.index) | set(inv.index))
    demand_pivot = demand_pivot.reindex(all_ingredients, fill_value=0.0)
    stock_by_date = stock_by_date.reindex(all_ingredients)

    rows = []
    for ing in all_ingredients:
        if ing not in inv.index:
            continue
        current_qty = float(inv.loc[ing, "current_quantity"])
        safety_stock = float(inv.loc[ing, "safety_stock_quantity"])
        total_demand = float(demand_pivot.loc[ing].sum())
        avg_daily_demand = total_demand / len(dates) if len(dates) else 0.0

        remaining, stockout_date, first_below_safety, unfilled = None, None, None, 0.0
        for d in dates:
            usable_today = stock_by_date.loc[ing, d]
            usable_today = 0.0 if pd.isna(usable_today) else usable_today
            remaining = usable_today if remaining is None else min(remaining, usable_today)
            if remaining <= safety_stock and first_below_safety is None:
                first_below_safety = d
            demand_today = demand_pivot.loc[ing, d]
            servable = min(max(remaining, 0.0), demand_today)
            unfilled += max(demand_today - servable, 0.0)
            remaining -= demand_today
            if remaining < 0 and stockout_date is None:
                stockout_date = d

        days_until_stockout = None if stockout_date is None else (stockout_date - dates[0]).days
        end_inventory_no_order = max(remaining, 0.0) if remaining is not None else None
        cover_days = (current_qty / avg_daily_demand) if avg_daily_demand > 0 else None

        # Our own convenience bucketing -- backend's own comment says the
        # official risk-level categories are still pending, so this is a
        # clearly-labeled convention, not an authoritative source value.
        if days_until_stockout is None:
            risk_level = "Low"
        elif days_until_stockout <= 2:
            risk_level = "Critical"
        elif days_until_stockout <= 5:
            risk_level = "Moderate"
        else:
            risk_level = "Low"

        affected = menu_recipes.loc[
            (menu_recipes["ingredient_id"] == ing) &
            (menu_recipes["inventory_consumption_eligible"].astype(str).str.lower() == "true"),
            "menu_variant_id"].unique().tolist()

        rows.append({
            "prediction_as_of_date": _fmt_date(dates[0]),
            "ingredient_id": ing,
            "ingredient_name": im.loc[ing, "ingredient_name"] if ing in im.index else None,
            "category": im.loc[ing, "ingredient_group_code"] if ing in im.index else None,
            "unit": inv.loc[ing, "unit"],
            "current_inventory_quantity": _fmt_num(current_qty),
            "safety_stock_quantity": _fmt_num(safety_stock),
            "ten_day_forecast_demand_quantity": _fmt_num(total_demand) if is_full_ten_day else None,
            "projected_expired_quantity": _fmt_num(waste_by_ingredient.get(ing, 0.0)),
            "projected_unfilled_demand_quantity": _fmt_num(unfilled),
            "projected_end_inventory_no_order": _fmt_num(end_inventory_no_order),
            "estimated_stock_cover_days": _fmt_num(cover_days),
            "first_below_safety_date": _fmt_date(first_below_safety),
            "predicted_stockout_date": _fmt_date(stockout_date),
            "days_until_stockout": days_until_stockout,
            "runout_risk_level": risk_level,
            "priority_score": None,   # source range undefined -- left unsupported
            "affected_menu_variants": "|".join(affected) if affected else None,
            "recommended_action": None,
            "is_synthetic": IS_SYNTHETIC,
        })
        
    return pd.DataFrame(rows)


def build_order_recommendations_export(orders, forecast, menu_recipes, batches, current_inventory,
                                        suppliers, review_period_days=7):
    inv = current_inventory.set_index("ingredient_id")
    supplier_primary = (suppliers[suppliers["is_primary_supplier"]]
                         .drop_duplicates("ingredient_id").set_index("ingredient_id"))

    daily_demand = oo.explode_ingredient_demand(forecast, menu_recipes, "p50")
    dates = sorted(daily_demand["date"].unique())
    stock_by_date = oo.usable_stock_by_date(batches, dates)
    demand_pivot = (daily_demand.pivot(index="ingredient_id", columns="date", values="ingredient_demand")
                                 .fillna(0.0).reindex(columns=dates, fill_value=0.0))

    rows = []
    for _, r in orders.iterrows():
        ing = r["ingredient_id"]
        usable_current = float(inv.loc[ing, "current_quantity"]) if ing in inv.index else None
        safety_stock = float(inv.loc[ing, "safety_stock_quantity"]) if ing in inv.index else None
        expected_delivery = pd.Timestamp(r["order_by_date"]) + pd.Timedelta(days=r["lead_time_days"])
        total_demand = float(demand_pivot.loc[ing].sum()) if ing in demand_pivot.index else None

        # End-of-window stock with no order, then add the recommended order --
        # treats the order as available for the rest of the window rather than
        # modeling its exact arrival day. A simplification, not a hidden one.
        remaining = None
        for d in dates:
            usable_today = stock_by_date.loc[ing, d] if ing in stock_by_date.index else np.nan
            usable_today = 0.0 if pd.isna(usable_today) else usable_today
            remaining = usable_today if remaining is None else min(remaining, usable_today)
            remaining -= demand_pivot.loc[ing, d] if ing in demand_pivot.index else 0.0
        end_after_order = max(remaining, 0.0) + r["recommended_order_quantity"] if remaining is not None else None

        sup = supplier_primary.loc[ing] if ing in supplier_primary.index else None
        unit_cost = float(sup["unit_cost_aud"]) if sup is not None else None
        goods_cost = r["order_packs"] * float(sup["pack_cost_aud"]) if sup is not None else None
        delivery_fee = None
        if sup is not None and goods_cost is not None:
            delivery_fee = 0.0 if goods_cost >= float(sup["free_delivery_threshold_aud"]) else float(sup["delivery_fee_aud"])

        rows.append({
            "order_recommendation_id": _new_id("OR"),
            "recommendation_date": _fmt_date(r["order_by_date"]),
            "ingredient_id": ing,
            "ingredient_name": r.get("ingredient_name"),
            "unit": r["unit"],
            "order_required": True,
            "forecast_demand_quantity": _fmt_num(total_demand),
            "usable_current_inventory_quantity": _fmt_num(usable_current),
            "safety_stock_quantity": _fmt_num(safety_stock),
            "raw_order_requirement_quantity": _fmt_num(r["recommended_order_quantity"]),
            "recommended_order_packs": _fmt_int(r["order_packs"]),
            "pack_size": _fmt_num(r["recommended_order_quantity"] / r["order_packs"]) if r["order_packs"] else None,
            "recommended_order_quantity": _fmt_num(r["recommended_order_quantity"]),
            "projected_end_stock_after_order": _fmt_num(end_after_order),
            "supplier_id": r["supplier_id"],
            "supplier_name": r["supplier_name"],
            "unit_cost_aud": _fmt_money(unit_cost, 5),
            "line_subtotal_aud": _fmt_money(goods_cost),
            "supplier_delivery_fee_aud": _fmt_money(delivery_fee),
            "estimated_total_supplier_order_aud": _fmt_money(r["estimated_cost_aud"]),
            "order_cutoff_time": sup["order_cutoff_time"] if sup is not None else None,
            "expected_delivery_date": _fmt_date(expected_delivery),
            "order_urgency": r["urgency"],   # our own convention -- flagged, see below
            "recommendation_reason": (
                f"Projected to cross the reorder point on {r['order_by_date'].strftime('%Y-%m-%d')}; "
                f"ordering now covers roughly the next {review_period_days} days."
            ),
            "is_synthetic": IS_SYNTHETIC,
        })

    return pd.DataFrame(rows)


def build_expiry_menu_actions_export(waste, batches, menu_recipes, action_generated_date):
    recipe_eligible = menu_recipes[menu_recipes["inventory_consumption_eligible"].astype(str).str.lower() == "true"]
    batch_lookup = batches.set_index("batch_id")

    rows = []
    for _, w in waste.iterrows():
        ing = w["ingredient_id"]
        candidates = recipe_eligible[recipe_eligible["ingredient_id"] == ing]
        chosen = None
        if not candidates.empty:
            # The dish using the MOST of this ingredient per portion moves
            # the most volume per unit sold -- our own "best lever" choice,
            # not an official rule.
            chosen = candidates.loc[candidates["effective_quantity_per_portion"].idxmax()]

        original_qty = float(batch_lookup.loc[w["batch_id"], "quantity_remaining"])
        qty_per_portion = float(chosen["effective_quantity_per_portion"]) if chosen is not None else None
        additional_portions = (math.ceil(w["quantity_wasted"] / qty_per_portion)
                                if qty_per_portion and qty_per_portion > 0 else None)

        rows.append({
            "expiry_action_id": _new_id("EA"),
            "action_generated_date": _fmt_date(action_generated_date),
            "batch_id": w["batch_id"],
            "ingredient_id": ing,
            "ingredient_name": w.get("ingredient_name"),
            "expiry_date": _fmt_date(w["expiry_date"]),
            "days_until_expiry": int((pd.Timestamp(w["expiry_date"]) - pd.Timestamp(action_generated_date)).days),
            "batch_quantity_remaining": _fmt_num(original_qty),
            "unit": batch_lookup.loc[w["batch_id"], "unit"],
            "projected_batch_usage_before_expiry": _fmt_num(original_qty - w["quantity_wasted"]),
            "projected_waste_quantity": _fmt_num(w["quantity_wasted"]),
            "inventory_value_at_risk_aud": _fmt_money(w["estimated_waste_value_aud"]),
            "expiry_risk_level": "Critical" if w["quantity_wasted"] / original_qty > 0.5 else "Moderate",  # our own convention
            "recommended_menu_item_id": chosen["menu_item_id"] if chosen is not None else None,
            "recommended_menu_variant_id": chosen["menu_variant_id"] if chosen is not None else None,
            "recommended_menu_item_name": chosen["menu_variant_name"] if chosen is not None else None,
            "ingredient_quantity_per_portion": _fmt_num(qty_per_portion),
            "recommended_additional_portions": additional_portions,
            "recommended_discount_pct": None,           # a manager/marketing call, not ours to invent
            "promotion_start_date": _fmt_date(action_generated_date),
            "promotion_end_date": _fmt_date(w["expiry_date"]),
            "estimated_incremental_revenue_aud": None,   # would need an assumed discount/elasticity -- unsupported
            "estimated_waste_value_avoided_aud": _fmt_money(w["estimated_waste_value_aud"]),  # if fully successful
            "recommended_action": (
                f"Feature or discount {chosen['menu_variant_name']} to help sell through "
                f"{w['quantity_wasted']:.0f}{batch_lookup.loc[w['batch_id'], 'unit']} of "
                f"{w.get('ingredient_name')} before it expires on {w['expiry_date'].strftime('%Y-%m-%d')}."
            ) if chosen is not None else None,
            "is_synthetic": IS_SYNTHETIC,
        })

    return pd.DataFrame(rows)