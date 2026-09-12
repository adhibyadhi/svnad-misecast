import pandas as pd


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


def load_recipe(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";")
    df = df.dropna(how="all")
    df = df.loc[:, ~df.columns.str.contains("^Unnamed")]
    df["menu_item_id"] = df["menu_item_id"].str.strip()
    df["size"] = df["menu_item_name"].str.extract(r"-\s*(Small|Large)$")[0].str.lower()
    df["preparation_loss_pct"] = df["preparation_loss_pct"].str.rstrip("%").astype(float) / 100
    return df.reset_index(drop=True)


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