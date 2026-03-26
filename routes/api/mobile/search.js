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

    // 1) Find matching stores first
    const stores = await Store.find(storeFilter)
      .sort({ name: 1 })
      .limit(20)
      .lean();

    const matchedStoreIds = stores.map((s) => s._id);

    // 2) Find products that match either:
    //    - their own fields
    //    - OR belong to matched stores
    const productFilter = {
      isActive: true,
      $or: [
        { name: regex },
        { name_ar: regex },
        { details: regex },
        { details_ar: regex },
        ...(matchedStoreIds.length > 0 ? [{ storeId: { $in: matchedStoreIds } }] : []),
      ],
    };

    const products = await Product.find(productFilter)
      .populate("storeId", "name name_ar address type logo")
      .sort({ name: 1 })
      .limit(50)
      .lean();

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

router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    const filter = q
      ? { name: { $regex: q, $options: "i" } }
      : {};

    const products = await Product.find(filter).lean();

    res.render("frontend/search", {
      layout: "frontend-layout",
      products,
      query: q,
      cart: req.session.cart || [],
    });
  } catch (err) {
    console.error("Search page error:", err);
    res.status(500).send("Server error");
  }
});

module.exports = router;