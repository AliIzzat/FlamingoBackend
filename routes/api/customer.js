const express = require("express");
const router = express.Router();
const { Types } = require("mongoose");
const Product = require("../../models/Product");

router.get("/products", async (req, res) => {
  try {
    const { category, storeId } = req.query;

    console.log("Incoming query:", { category, storeId });
    console.log("Collection:", Product.collection.name);

    // 1) count everything
    const total = await Product.countDocuments({});
    console.log("Total products:", total);

    // 2) count by category
    const catCount = category ? await Product.countDocuments({ category }) : null;
    console.log("Category count:", catCount);

    // 3) count by storeId (both styles)
    let storeCount = null;
    if (storeId) {
      const or = [{ storeId }];
      if (Types.ObjectId.isValid(storeId)) or.push({ storeId: new Types.ObjectId(storeId) });

      storeCount = await Product.countDocuments({ $or: or });
      console.log("StoreId count:", storeCount);
    }

    // 4) final filter
    const filter = {};
    if (category) filter.category = category;
     if (storeId) {
      filter.$or = [{ storeId: storeId }];
      if (Types.ObjectId.isValid(storeId)) {
        filter.$or.push({ storeId: new Types.ObjectId(storeId) });
      }
    }

    console.log("Final filter:", JSON.stringify(filter));
    const sample = await Product.findOne({ category: "meal" }).lean();
    console.log("Sample meal product:", sample);

    const products = await Product.find(filter).lean();
    return res.json({ ok: true, total, catCount, storeCount, filter, products });
  } catch (err) {
    console.error("GET /products error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});
module.exports = router;
