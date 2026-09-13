import mongoose from "mongoose";
import crypto from "crypto";

import { MENU_NAMES } from "./menuValues.js";

const predictionFields = {
  _id: {
    type: String,
    default: () => crypto.randomUUID(),
  },
};

for (let i = 1; i <= 15; i++) {
  predictionFields[`menu_${i}`] = {
    type: String,
    required: true,
    enum: MENU_NAMES,
  };

  predictionFields[`menu_${i}_amount`] = {
    type: Number,
    required: true,
    min: 0,

    validate: {
      validator: Number.isInteger,

      message: `menu_${i}_amount must be a whole number.`,
    },
  };
}

const predictedSalesSchema = new mongoose.Schema(predictionFields, {
  collection: "predicted_sales_from_ml",

  versionKey: false,
});

const PredictedSales = mongoose.model("PredictedSales", predictedSalesSchema);

export default PredictedSales;
