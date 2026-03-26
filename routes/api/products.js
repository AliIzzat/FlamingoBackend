const express = require("express");
const router = express.Router();
const Product = require("../../models/Product");

// GET /api/products/names/:type
router.get("/names/:type", async (req, res) => {
  try {
    const type = String(req.params.type || "").trim().toLowerCase();

    const names = await Product.distinct("name", {
      "storeSnapshot.type": type,
      isActive: true,
    });

    return res.json({
      ok: true,
      type,
      count: names.length,
      names,
    });
  } catch (err) {
    console.error("Error fetching product names by type:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
});

module.exports = router;