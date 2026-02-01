// models/Category.js
const mongoose = require("mongoose");
const CategorySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9_]+$/,
    },
    name_en: { type: String, required: true },
    name_ar: { type: String, default: "" },
    icon: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);
CategorySchema.index({ isActive: 1, sortOrder: 1 });
module.exports = mongoose.model("Category", CategorySchema);

