const mongoose = require("mongoose");
const notificationSchema = new mongoose.Schema(
  {
    message: { type: String, default: "" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    // ✅ driver who claimed this order (null when unpicked)
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    status: {
      type: String,
      enum: ["unpicked", "claimed", "picked", "delivered", "cancelled"],
      default: "unpicked",
      index: true,
    },
    // Keep these explicit for your UI (“time since”)
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: null },
  },
  { versionKey: false }
);
module.exports = mongoose.model("Notification", notificationSchema);


