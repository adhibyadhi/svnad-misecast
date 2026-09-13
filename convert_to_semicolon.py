import csv
from pathlib import Path

SOURCE_DIRS = [Path("data"), Path("data/mongo_import")]
OUTPUT_DIR = Path("data/import_ready")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

FILES = [
    "menu_items.csv", "ingredient_master.csv", "menu_variants.csv",
    "menu_recipes.csv", "suppliers.csv", "inventory_batches_expiry.csv",
    "promotion_history.csv", "historical_sales.csv", "weather.csv",
    "reservations.csv", "local_events.csv", "data_dictionary.csv",
    "data_assumptions.csv", "demand_forecast.csv", "runout_predictions.csv",
    "order_recommendations.csv", "expiry_menu_actions.csv",
]

converted, missing = 0, []
for filename in FILES:
    source_path = next((d / filename for d in SOURCE_DIRS if (d / filename).exists()), None)
    if source_path is None:
        missing.append(filename)
        continue
    with open(source_path, "r", encoding="utf-8-sig", newline="") as infile:
        rows = list(csv.reader(infile))  # parses comma-delimited, respects quoting
    with open(OUTPUT_DIR / filename, "w", encoding="utf-8", newline="") as outfile:
        csv.writer(outfile, delimiter=";", quoting=csv.QUOTE_MINIMAL).writerows(rows)
    converted += 1
    print(f"converted {source_path} -> {OUTPUT_DIR / filename}")

print(f"\n{converted} files converted into {OUTPUT_DIR}/")
if missing:
    print("MISSING:", missing)