"""
Temporary FastAPI ML placeholder.

This is NOT the real machine learning model.

It only lets us test communication between:

Express -> FastAPI -> MongoDB
"""

from fastapi import FastAPI
from typing import Any, Dict


app = FastAPI()


@app.get("/")
def home():

    return {
        "message": "ML placeholder is running"
    }


@app.post("/predict")
def predict(
    ml_input: Dict[str, Any]
):

    """
    Receive ONE day's ML input and return
    predicted sales for all 15 menu items.
    """

    total_reservation = int(
        ml_input.get(
            "total_reservation",
            0
        )
    )


    prediction = {}


    for i in range(1, 16):

        menu_key = f"menu_{i}"

        amount_key = (
            f"menu_{i}_amount"
        )


        menu_name = (
            ml_input.get(
                menu_key
            )
        )


        # Fake calculation only.
        #
        # Different menu positions get slightly
        # different values so the test output
        # is easier to see.
        multiplier = (
            0.25 +
            (i * 0.02)
        )


        predicted_amount = round(
            total_reservation *
            multiplier
        )


        prediction[
            menu_key
        ] = menu_name


        prediction[
            amount_key
        ] = max(
            0,
            predicted_amount
        )


    return prediction