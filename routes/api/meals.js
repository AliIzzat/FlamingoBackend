// routes/api/meals.js
const express = require("express");
const router = express.Router();

// ✅ Try common model paths/names used in your project.
// Adjust ONLY if your model file is in a different place.
let MealModel = null;

try {
  // many projects use models/Meal.js
  MealModel = require("../../models/Meal");
} catch (e1) {
  try {
    // some older parts used Food / foods
    MealModel = require("../../models/Food");
  } catch (e2) {
    try {
      // you previously mentioned Food is actually Meal
      MealModel = require("../../models/Meal"); // keep fallback
    } catch (e3) {
      MealModel = null;
    }
  }
}

router.get("/", async (req, res) => {
  try {
    if (!MealModel) {
      return res.status(500).json({
        error: "Meal model not found",
        hint: "Check your model path/name in routes/api/meals.js",
      });
    }

    // Optional filters
    const { category, storeId, restaurantId, offer } = req.query;

    const filter = {};
    if (category) filter.category = category;          // if you have category field
    if (storeId) filter.storeId = storeId;             // if you have storeId
    if (restaurantId) filter.restaurant = restaurantId; // if you have restaurant ref
    if (offer === "true") filter.offer = true;

    const meals = await MealModel.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return res.json(meals);
  } catch (err) {
    console.error("❌ GET /api/meals error:", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
});

module.exports = router;
