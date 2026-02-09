// C:\Flamangos\models\FoodDef.js
const mongoose = require("mongoose");

const FoodSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  name_ar: { type: String, required: true, trim: true },
  price: { type: Number, required: true },

  // Reference to Restaurant document
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
  },

  restaurant_en: { type: String, trim: true },
  restaurant_ar: { type: String, trim: true },

  address: { type: String, default: "" },
  cuisine: { type: String, trim: true, lowercase: true },

  offer: { type: Boolean, default: false },
  period: { type: Number, default: 0 },

  image: { type: String, required: true },

  details: { type: String, trim: true, default: "" },
  details_ar: { type: String, trim: true, default: "" }
},
{
  collection: 'foods',          // 👈 use the existing "foods" collection
  timestamps: true
});

module.exports = mongoose.model("Food", FoodSchema);
