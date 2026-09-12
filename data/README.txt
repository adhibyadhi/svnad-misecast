Restaurant AI CSV Dataset - Updated Menu

Source menu workbook
Recipe and menu data_1_1(1).xlsx

Format
- Every CSV is semicolon-delimited.
- Dates use YYYY-MM-DD.
- Boolean values use true or false.
- Monetary fields use AUD.
- Each file has one header row and no merged cells.

Menu replacement
- The previous synthetic menu has been completely removed from this package.
- All operational and AI files now use MI-xxx menu IDs, menu_variant_id values and the ingredient IDs from the attached workbook.
- 67 parent menu items expand to 90 menu variants.
- 88 active variants are included in sales and model data. MI-067 Small and Large are retained but excluded because the source marks the item inactive and has no price or cost.

Create Your Own Bowl treatment
- MI-014 through MI-025 have Small and Large prices, so they are represented as 24 variants.
- The source recipe contains only the protein selection. Each size receives four clearly labelled assumed components: jasmine rice, mixed leaves, assorted sauce and assorted topping.
- Large recipe quantities are scaled using each item food-cost ratio. Replace these assumptions with actual POS modifier choices when available.

Sales size treatment
- Parent sales counts were not split by size in the source. Synthetic history uses a temporary 50 percent Small and 50 percent Large mix.

Synthetic data warning
- Menu prices, menu costs and source recipe lines come from the attached workbook.
- Sales, inventory, expiry, suppliers, context signals and AI outputs are synthetic hackathon examples. Replace them with real POS, stock, invoice, booking, weather and event feeds before production use.

Files
- menu_items.csv: 67 data rows
- menu_variants.csv: 90 data rows
- menu_recipes.csv: 380 data rows
- ingredient_master.csv: 74 data rows
- historical_sales.csv: 44352 data rows
- current_inventory.csv: 73 data rows
- inventory_batches_expiry.csv: 96 data rows
- reservations.csv: 188 data rows
- weather.csv: 94 data rows
- local_events.csv: 6 data rows
- calendar_context.csv: 94 data rows
- suppliers.csv: 73 data rows
- promotion_history.csv: 18 data rows
- model_input_table.csv: 14784 data rows
- demand_forecast.csv: 1760 data rows
- ingredient_demand_forecast.csv: 730 data rows
- runout_predictions.csv: 73 data rows
- order_recommendations.csv: 73 data rows
- expiry_menu_actions.csv: 37 data rows
- data_assumptions.csv: 6 data rows
- data_dictionary.csv: 356 data rows
- validation_summary.json: package-level checks and counts
