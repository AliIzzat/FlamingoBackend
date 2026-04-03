// routes/api/meals.js
const express = require("express");
const router = express.Router();
const Product = require("../../models/Product");
const MealModel = require("../../models/Meals");

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

router.get("/:id", async (req, res) => {
  console.log("✅ HIT /api/meals/:id", req.params.id);
  try {
    const meal = await Product.findById(req.params.id).lean();

    if (!meal) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json(meal);
  } catch (err) {
    console.error("GET /api/meals/:id error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;