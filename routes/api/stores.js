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
// GET /api/stores/names/:type
router.get("/names/:type", async (req, res) => {
  try {
    const type = String(req.params.type || "").trim().toLowerCase();

    const names = await Store.distinct("name", { type, isActive: true });

    res.json({
      ok: true,
      type,
      count: names.length,
      names,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});


module.exports = router;
