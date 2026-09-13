import mongoose from "mongoose";
import { MENU_NAMES, MENU_CATEGORIES } from "./menuValues.js";

const menuSchema = new mongoose.Schema(
  {
    /*
     * We are keeping your database design
     * where _id is a string UUID.
     */
    _id: {
      type: String,

      required: true,
    },

    name: {
      type: String,

      required: true,

      enum: MENU_NAMES,

      unique: true,

      trim: true,
    },

    category: {
      type: String,

      required: true,

      enum: MENU_CATEGORIES,
    },

    price: {
      type: Number,

      required: true,

      min: 0,
    },
  },
  {
    collection: "menu",
  },
);

const Menu = mongoose.model("Menu", menuSchema);

export default Menu;
