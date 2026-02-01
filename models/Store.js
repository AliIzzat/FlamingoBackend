// models/Store.js
const mongoose = require("mongoose");
const StoreSchema = new mongoose.Schema(
  {
    type: {
      type: String,        // ← category.key
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    name_ar: { type: String, default: "" },
    address: { type: String, default: "" },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },
    logo: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
StoreSchema.index({ type: 1, isActive: 1 });
StoreSchema.index({ location: "2dsphere" });
module.exports = mongoose.model("Store", StoreSchema);