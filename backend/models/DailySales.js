import mongoose from "mongoose";

const dailySalesSchema = new mongoose.Schema(
  {
    _id: {
      type: String,

      required: true,
    },

    date: {
      type: Date,

      required: true,
    },

    menu_id: {
      type: String,

      required: true,

      ref: "Menu",
    },

    amount_sold: {
      type: Number,

      required: true,

      min: 0,
    },
  },
  {
    collection: "daily_sales",
  },
);

const DailySales = mongoose.model("DailySales", dailySalesSchema);

export default DailySales;
