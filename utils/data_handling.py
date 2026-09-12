import pandas as pd


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna(how="all")
    df = df.loc[:, ~df.columns.str.contains("^Unnamed")]
    return df.reset_index(drop=True)


def load_menu(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";")
    df = df.dropna(how="all")
    df = df.loc[:, ~df.columns.str.contains("^Unnamed")]
    df.columns = [c.strip().replace(" ", "") for c in df.columns]
    df = df.rename(columns={
        "menu_item_name": "name",
        "sale_price_aud_small": "price_small",
        "sale_price_aud_large": "price_large",
        "estimated_food_cost_aud_small": "food_cost_small",
        "estimated_food_cost_aud_large": "food_cost_large",
    })
    df["active"] = df["active"].astype(bool)
    df["menu_item_id"] = df["menu_item_id"].str.strip()
    return df.reset_index(drop=True)


def load_menu_items(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";")
    return _clean(df)


def load_menu_variants(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";")
    return _clean(df)


def load_menu_recipes(path: str) -> pd.DataFrame:
    """Variant-level recipe lines -- one row per (menu_variant_id, ingredient_id).
    Replaces the old size-guessing loader: sizes are now explicit
    (menu_variant_id) instead of text embedded in a name field, so there's
    no more regex extraction or build_blended_recipe() needed for this data."""
    df = pd.read_csv(path, sep=";")
    return _clean(df)


def load_recipe(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";")
    df = df.dropna(how="all")
    df = df.loc[:, ~df.columns.str.contains("^Unnamed")]
    df["menu_item_id"] = df["menu_item_id"].str.strip()
    df["size"] = df["menu_item_name"].str.extract(r"-\s*(Small|Large)$")[0].str.lower()
    df["preparation_loss_pct"] = df["preparation_loss_pct"].str.rstrip("%").astype(float) / 100
    return df.reset_index(drop=True)


def load_ingredient_master(path: str) -> pd.DataFrame:
    """Now shipped directly -- no need to derive it from recipe lines the
    way build_ingredient_master() did for the first real menu/recipe drop."""
    df = pd.read_csv(path, sep=";")
    return _clean(df)


def load_historical_sales(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";")
    df = _clean(df)
    df["date"] = pd.to_datetime(df["date"])
    return df


def check_recipe_completeness(recipe: pd.DataFrame, menu: pd.DataFrame) -> pd.DataFrame:
    """Flags dish-category menu items with suspiciously few recipe lines --
    a real dish should have more than just one ingredient."""
    dish_categories = {"Signature Nosh Bowls", "Protein Bento", "Create Your Own Bowl"}
    lines_per_item = recipe.groupby("menu_item_id").size().rename("recipe_line_count")
    check = menu.merge(lines_per_item, on="menu_item_id", how="left")
    check["recipe_line_count"] = check["recipe_line_count"].fillna(0).astype(int)
    thin = check[check["category"].isin(dish_categories) & (check["recipe_line_count"] <= 1)]
    return thin[["menu_item_id", "name", "category", "recipe_line_count"]]


def build_blended_recipe(recipe: pd.DataFrame, small_share: float = 0.5) -> pd.DataFrame:
    """Weighted-average Small/Large recipe lines into one line per
    (menu_item_id, ingredient_id). Items with no size split pass through
    unchanged. `small_share` is the assumed fraction of orders that are
    Small -- replace with a real Small/Large sales mix once you have one."""
    sized = recipe[recipe["size"].notna()].copy()
    unsized = recipe[recipe["size"].isna()].copy()

    weight = sized["size"].map({"small": small_share, "large": 1 - small_share})
    sized["weighted_qty"] = sized["effective_quantity_per_portion"] * weight

    blended = (
        sized.groupby(["menu_item_id", "ingredient_id", "ingredient_name", "unit"])["weighted_qty"]
        .sum()
        .reset_index()
        .rename(columns={"weighted_qty": "effective_quantity_per_portion"})
    )

    keep_cols = ["menu_item_id", "ingredient_id", "ingredient_name", "unit", "effective_quantity_per_portion"]
    return pd.concat([blended[keep_cols], unsized[keep_cols]], ignore_index=True)


PREFIX_CATEGORY = {
    "BASE": "Base / starch",
    "PROT": "Protein",
    "SAUC": "Sauce",
    "GARN": "Garnish / topping",
    "LEAF": "Leafy greens / salad",
    "SEAS": "Seasoning",
    "MISC": "Miscellaneous",
    "SNCK": "Packaged snack",
    "DRNK": "Packaged drink",
}


def build_ingredient_master(recipe: pd.DataFrame) -> pd.DataFrame:
    """Dedupes ingredient_id -> name/unit out of recipe.csv into a
    standalone ingredient master (Section 3's "Ingredient master" table).
    Also flags any ingredient_id that shows up with more than one distinct
    name or unit across recipe lines - a real data inconsistency worth
    fixing at the source rather than silently picking one."""
    grouped = recipe.groupby("ingredient_id").agg(
        names=("ingredient_name", lambda s: sorted(s.unique())),
        units=("unit", lambda s: sorted(s.unique())),
        used_in_menu_items=("menu_item_id", "nunique"),
    )

    inconsistent = grouped[
        (grouped["names"].apply(len) > 1) | (grouped["units"].apply(len) > 1)
    ]
    if len(inconsistent):
        print(f"WARNING: {len(inconsistent)} ingredient_id(s) have inconsistent "
              f"name/unit across recipe lines -- check these before trusting the master:")
        print(inconsistent[["names", "units"]])

    master = grouped.reset_index()
    master["ingredient_name"] = master["names"].str[0]
    master["unit"] = master["units"].str[0]
    master["prefix"] = master["ingredient_id"].str.extract(r"^([A-Z]+)-")
    master["category"] = master["prefix"].map(PREFIX_CATEGORY).fillna("Uncategorized")

    # Not present in recipe.csv - has to come from the team/a chef,
    # not something we can infer from recipe lines.
    master["storage_type"] = pd.NA
    master["unit_cost_aud"] = pd.NA

    return master[[
        "ingredient_id", "ingredient_name", "category", "unit",
        "storage_type", "unit_cost_aud", "used_in_menu_items",
    ]].sort_values(["category", "ingredient_id"]).reset_index(drop=True)