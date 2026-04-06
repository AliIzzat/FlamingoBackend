// routes/api/meals.js
const express = require("express");
const router = express.Router();
const Product = require("../../models/Product");
const MealModel = require("../../models/Meals");

router.get("/", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");

    const { limit = 30, offer } = req.query;

    const q = {};
    if (offer === "true") q.offer = true;

    const meals = await MealModel.find(q)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    return res.json({
      ok: true,
      meals,
    });
  } catch (err) {
    console.error("❌ GET /api/meals error:", err);
    return res.status(500).json({
      ok: false,
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