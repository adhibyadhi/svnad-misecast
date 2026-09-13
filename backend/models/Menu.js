import mongoose from "mongoose";

const menuNames = [
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

const menuCategories = ["HOT_DRINK", "COLD_DRINK", "MAIN", "SIDE"];

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

      enum: menuNames,

      unique: true,

      trim: true,
    },

    category: {
      type: String,

      required: true,

      enum: menuCategories,
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
