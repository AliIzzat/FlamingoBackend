// routes/api/mobile/categories.js
const express = require("express");
const router = express.Router();
const Category = require("../../../models/Category");

// GET /api/mobile/categories
router.get("/", async (_req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ sortOrder: 1, createdAt: 1 })
      .select("key name_en name_ar icon sortOrder isActive")
      .lean();

    return res.json({ ok: true, categories });
  } catch (e) {
    console.error("❌ mobile categories:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;