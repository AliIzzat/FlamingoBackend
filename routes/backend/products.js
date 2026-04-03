const express = require("express");
const router = express.Router();
const Product = require("../../models/Product");
const Store = require("../../models/Store");
const Category = require("../../models/Category");
const upload = require("../../middleware/upload"); // if you already use multer

router.get("/", async (req, res) => {
  try {
    const firstValue = (v) => Array.isArray(v) ? v[0] : v;
    const selectedType = String(firstValue(req.query.type) || "").trim();
    const selectedStoreId = String(firstValue(req.query.storeId) || "").trim();

    const categories = await Category.find({ isActive: true })
      .sort({ name_en: 1 })
      .lean();

    const storeFilter = {};
    if (selectedType) {
      storeFilter.type = selectedType;
    }

    const storesForPicker = await Store.find(storeFilter)
      .sort({ name: 1 })
      .lean();

    let selectedStore = null;
    if (selectedStoreId) {
      selectedStore = await Store.findById(selectedStoreId).lean();
    }

    let products = [];
    if (selectedStore) {
      products = await Product.find({ storeId: selectedStore._id })
        .sort({ createdAt: -1 })
        .lean();
    }

    res.render("backend/products", {
      categories,
      storesForPicker,
      selectedType,
      selectedStoreId,
      selectedStore,
      products,
    });
  } catch (err) {
    console.error("❌ GET /admin/products error:", err);
    res.status(500).send("Failed to load products page: " + err.message);
  }
});
// Show edit form
router.get("/products/edit/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).lean();
    if (!product) {
      return res.status(404).send("Product not found");
    }

    const stores = await Store.find().sort({ name: 1 }).lean();
    const categories = await Category.find().sort({ name: 1 }).lean();

    res.render("backend/edit-product", {
      layout: "backend-layout",
      product,
      stores,
      categories,
    });
  } catch (err) {
    console.error("GET edit product error:", err);
    res.status(500).send("Server error");
  }
});

// Save edited product
router.post("/update/:id", upload.single("image"), async (req, res) => {
  try {
    console.log("REQ BODY:", req.body);
    console.log("REQ FILE:", req.file);
    console.log("PRODUCT ID:", req.params.id);

    const firstValue = (v) => Array.isArray(v) ? v[0] : v;
    const asText = (v) => String(firstValue(v) || "").trim();
    const asBool = (v) => String(firstValue(v)) === "true";
    const asNumber = (v) => Number(firstValue(v) || 0) || 0;

    const returnTo = firstValue(req.body.returnTo) || "/admin/products";

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).send("Product not found");
    }

    product.name = asText(req.body.name);
    product.name_ar = asText(req.body.name_ar);
    product.details = asText(req.body.details);
    product.details_ar = asText(req.body.details_ar);
    product.price = asNumber(req.body.price);
    product.offer = asBool(req.body.offer);
    product.offerPrice = product.offer ? asNumber(req.body.offerPrice) : 0;
    product.isActive = asBool(req.body.isActive);

    if (req.file) {
      product.image = `/uploads/${req.file.filename}`;
    }

    await product.save();

    return res.redirect(returnTo);
  } catch (err) {
    console.error("❌ POST /admin/products/update/:id error:", err);
    res.status(500).send("Server error");
  }
});

module.exports = router;