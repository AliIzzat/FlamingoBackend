const express = require("express");
const router = express.Router();
const Product = require("../../models/Product");
const Store = require("../../models/Store");
const Category = require("../../models/Category");
const upload = require("../../middleware/upload"); // if you already use multer

router.get("/", async (req, res) => {
  try {
    const selectedType = (req.query.type || "").trim();
    const selectedStoreId = (req.query.storeId || "").trim();

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
router.post("/products/edit/:id", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      name_ar,
      description,
      description_ar,
      price,
      offerPrice,
      hasOffer,
      storeId,
      category,
      inStock,
    } = req.body;

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).send("Product not found");
    }

    product.name = name?.trim() || product.name;
    product.name_ar = name_ar?.trim() || "";
    product.description = description?.trim() || "";
    product.description_ar = description_ar?.trim() || "";
    product.price = Number(price) || 0;
    product.offerPrice = hasOffer === "on" ? Number(offerPrice) || 0 : 0;
    product.hasOffer = hasOffer === "on";
    product.storeId = storeId || null;
    product.category = category || product.category;
    product.inStock = inStock === "on";

        if (req.file) {
        product.image = `/uploads/${req.file.filename}`;
        console.log("Uploaded image:", product.image);
      }
      else if (req.body.seedImage && String(req.body.seedImage).trim()) {
        product.image = `/seed/${String(req.body.seedImage).trim()}`;
        console.log("Seed image:", product.image);
      }

    await product.save();

    res.redirect(`/backend/products/store/${product.storeId}`);
  } catch (err) {
    console.error("POST edit product error:", err);
    res.status(500).send("Server error");
  }
});

module.exports = router;