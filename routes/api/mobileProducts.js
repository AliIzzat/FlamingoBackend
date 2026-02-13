// routes/api/mobileProducts.js
const express = require("express");
const router = express.Router();

const Product = require("../../models/Product"); // your Product model

router.get("/", async (req, res) => {
  try {
    const { storeId, limit = 200, offer } = req.query;

    const q = {};
    if (storeId) q.storeId = storeId;      // ✅ FIXED (top-level field)
    if (offer === "true") q.offer = true;

    const products = await Product.find(q)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    return res.json({ ok: true, products });
  } catch (err) {
    console.error("❌ GET /api/mobile/products error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
