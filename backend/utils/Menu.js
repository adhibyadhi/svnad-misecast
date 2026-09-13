import mongoose from "mongoose";

export const MENU_NAMES = [
  "Chicken Teriyaki Bowl",
  "Sashimi Poke Bowl",
  "Wagyu Beef Bowl",
  "Miso Falafel Bowl",
  "Karaage Chicken Bowl",
  "Tofu Bowl",
  "Salmon Aburi Bowl",
  "Miso soup",
  "Bone Broth soup",
  "Coconut water",
  "Sparkling water",
  "Yuzu tea",
  "Specialty Soda",
  "Hot Chocolate",
  "Still waterr",
];

export const MENU_CATEGORIES = ["HOT_DRINK", "COLD_DRINK", "MAIN", "SIDE"];

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

    active: {
      type: Boolean,

      default: true,

      required: true,
    },
  },
  {
    collection: "menu",
  },
);

const Menu = mongoose.model("Menu", menuSchema);

export default Menu;
