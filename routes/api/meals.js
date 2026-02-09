// routes/api/meals.js
const express = require("express");
const router = express.Router();

const MealModel = require("../../models/Meals"); // ✅ ONLY model you have

router.get("/", async (req, res) => {
  try {
    const meals = await MealModel.find()
      .sort({ createdAt: -1 })
      .lean();

    return res.json(meals);
  } catch (err) {
    console.error("❌ GET /api/meals error:", err);
    return res.status(500).json({
      error: "Server error",
      message: err.message,
    });
  }
});

module.exports = router;