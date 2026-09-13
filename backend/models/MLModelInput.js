import mongoose from "mongoose";
import crypto from "crypto";

import { MENU_NAMES } from "./menuValues.js";

const mlInputFields = {
  _id: {
    type: String,
    default: () => crypto.randomUUID(),
  },

  date: {
    type: Date,
    required: true,
  },
};

/*
 * Create:
 *
 * menu_1
 * menu_1_price_after_discount
 *
 * ...
 *
 * menu_15
 * menu_15_price_after_discount
 */
for (let i = 1; i <= 15; i++) {
  mlInputFields[`menu_${i}`] = {
    type: String,
    required: true,
    enum: MENU_NAMES,
  };

  mlInputFields[`menu_${i}_price_after_discount`] = {
    type: Number,
    required: true,
    min: 0,
  };
}

mlInputFields.total_reservation = {
  type: Number,
  required: true,
  min: 0,

  validate: {
    validator: Number.isInteger,

    message: "total_reservation must be a whole number.",
  },
};

mlInputFields.avg_temp = {
  type: Number,
  required: true,
};

mlInputFields.rain = {
  type: Boolean,
  required: true,
};

mlInputFields.public_holiday = {
  type: Boolean,
  required: true,
};

mlInputFields.num_of_event = {
  type: Number,
  required: true,
  min: 0,

  validate: {
    validator: Number.isInteger,

    message: "num_of_event must be a whole number.",
  },
};

const mlModelInputSchema = new mongoose.Schema(mlInputFields, {
  collection: "ml_model_input",

  versionKey: false,
});

const MLModelInput = mongoose.model("MLModelInput", mlModelInputSchema);

export default MLModelInput;
