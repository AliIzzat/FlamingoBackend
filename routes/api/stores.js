// routes/api/stores.js
const express = require("express");
const router = express.Router();

const Store = require("../../models/Store");

router.get("/", async (req, res) => {
  try {
    const stores = await Store.find().sort({ createdAt: -1 }).lean();
    return res.json(stores);
  } catch (err) {
    console.error("❌ GET /api/stores:", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
});

module.exports = router;
