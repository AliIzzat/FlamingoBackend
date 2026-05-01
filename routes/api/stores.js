// routes/api/stores.js
const express = require("express");
const router = express.Router();

const Store = require("../../models/Store");

router.get("/", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
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

router.get("/:id", async (req, res) => {
  try {
    const store = await Store.findById(req.params.id).lean();

    if (!store) {
      return res.status(404).json({
        ok: false,
        error: "Store not found",
      });
    }

    res.json({
      ok: true,
      store,
    });
  } catch (error) {
    console.log("❌ store detail error:", error);
    res.status(500).json({
      ok: false,
      error: "Server error",
    });
  }
});

module.exports = router;
