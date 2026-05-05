// routes/api/meals.js
const express = require("express");
const router = express.Router();
const Product = require("../../models/Product");

router.get("/", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");

    const { limit = 30, offer } = req.query;

    const q = {
      "storeSnapshot.type": "restaurant",
    };

    if (offer === "true") {
      q.offer = true;
    }

    const meals = await Product.find(q)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    const formattedMeals = meals.map((m) => ({
        ...m,
        storeId: m.storeId || m.storeSnapshot?._id || "",
        storeName: m.storeSnapshot?.name || "Store",
        storeNameAr: m.storeSnapshot?.name_ar || "",
        storeLogo: m.storeSnapshot?.logo || "",
      }));

      return res.json({
        ok: true,
        meals: formattedMeals,
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

module.exports = router;
