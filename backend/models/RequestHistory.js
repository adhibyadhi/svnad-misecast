import mongoose from "mongoose";
import crypto from "crypto";

const requestHistorySchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => crypto.randomUUID(),
    },

    prediction_id: {
      type: String,
      required: true,
      ref: "PredictedSalesFromML",
    },

    date: {
      type: Date,
      required: true,
    },
  },
  {
    collection: "request_history",

    versionKey: false,
  },
);

const RequestHistory = mongoose.model("RequestHistory", requestHistorySchema);

export default RequestHistory;
