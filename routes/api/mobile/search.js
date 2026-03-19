const express = require("express");
const router = express.Router();
const Store = require("../../../models/Store");
const Product = require("../../../models/Product");

router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const category = String(req.query.category || "").trim();

    if (!q) {
      return res.json({
        ok: true,
        stores: [],
        products: [],
      });
    }

    const regex = new RegExp(q, "i");

    const storeFilter = {
      isActive: true,
      $or: [
        { name: regex },
        { name_ar: regex },
        { address: regex },
      ],
    };

    if (category) {
      storeFilter.type = category;
    }

    const productFilter = {
      isActive: true,
      $or: [
        { name: regex },
        { name_ar: regex },
        { details: regex },
        { details_ar: regex },
      ],
    };

    const [stores, products] = await Promise.all([
      Store.find(storeFilter).sort({ name: 1 }).limit(20).lean(),
      Product.find(productFilter)
        .populate("storeId", "name name_ar address type logo")
        .sort({ name: 1 })
        .limit(30)
        .lean(),
    ]);

    const filteredProducts = category
      ? products.filter((p) => String(p?.storeId?.type || "") === category)
      : products;

    return res.json({
      ok: true,
      stores,
      products: filteredProducts,
    });
  } catch (err) {
    console.error("❌ search route error:", err);
    return res.status(500).json({
      ok: false,
      error: "Search failed",
    });
  }
});

module.exports = router;