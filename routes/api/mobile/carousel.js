const express = require("express");
const router = express.Router();
const CarouselSlide = require("../../../models/CarouselSlide");

// GET /api/mobile/carousel
router.get("/", async (req, res) => {
  try {
    const slides = await CarouselSlide.find({ isActive: true })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      slides,
    });
  } catch (err) {
    console.error("❌ GET /api/mobile/carousel error:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error",
    });
  }
});

module.exports = router;