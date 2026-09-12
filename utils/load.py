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