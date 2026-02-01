// models/Product.js
const mongoose = require("mongoose");
const ProductSchema = new mongoose.Schema(
  {
    category: {
      type: String,       // ← category.key
      required: true,
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    storeSnapshot: {
      type: { type: String, required: true }, // store.type
      name: { type: String, required: true },
      name_ar: { type: String, default: "" },
      logo: { type: String, default: "" },
      address: { type: String, default: "" },
    },
    name: { type: String, required: true },
    name_ar: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    image: { type: String, default: "" },
    offer: { type: Boolean, default: false },
    offerPrice: { type: Number, default: null },
    details: { type: String, default: "" },
    details_ar: { type: String, default: "" },
    stockQty: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
// indexes ONCE
ProductSchema.index({ storeId: 1, category: 1 });
ProductSchema.index({ category: 1, offer: 1, isActive: 1 });
module.exports = mongoose.model("Product", ProductSchema);


