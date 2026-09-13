import mongoose from "mongoose";

const promotionSchema = new mongoose.Schema(
  {
    _id: {
      type: String,

      required: true,
    },

    menu_item: {
      type: String,

      required: true,

      trim: true,
    },

    percentage_discount: {
      type: Number,

      required: true,

      min: 0,

      max: 100,
    },

    date: {
      type: Date,

      required: true,
    },
  },
  {
    collection: "promotion",
  },
);

const Promotion = mongoose.model("Promotion", promotionSchema);

export default Promotion;
