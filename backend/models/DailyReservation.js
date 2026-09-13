import mongoose from "mongoose";

const dailyReservationSchema = new mongoose.Schema(
  {
    _id: {
      type: String,

      required: true,
    },

    date: {
      type: Date,

      required: true,
    },

    total_reservation: {
      type: Number,

      required: true,

      min: 0,
    },

    total_people: {
      type: Number,

      required: true,

      min: 0,
    },
  },
  {
    collection: "daily_reservation",
  },
);

const DailyReservation = mongoose.model(
  "DailyReservation",
  dailyReservationSchema,
);

export default DailyReservation;
