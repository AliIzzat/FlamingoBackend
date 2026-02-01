// routes/backend/adminCategories.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Category = require("../../models/Category");
const Store = require("../../models/Store");
const Product = require("../../models/Product");

// GET /admin/categories/create (safety redirect)
router.get("/create", (_req, res) => res.redirect("/admin/categories"));

// GET /admin/categories
router.get("/", async (req, res) => {
  try {
    const categories = await Category.find()
      .sort({ isActive: -1, sortOrder: 1, createdAt: 1 })
      .lean();

    // Dropdown keys: show existing keys + allow creating a NEW one by typing in UI (recommended)
    const keysForDropdown = categories.map((c) => c.key);

   return res.render("backend/categories", {
  layout: "backend-layout",   // ✅ FORCE admin layout
  title: "Categories",
  categories,
  keysForDropdown,
  user: req.session.user,     // ✅ optional but recommended
});

  } catch (e) {
    console.error("❌ Load categories:", e);
    return res.status(500).send("Failed to load categories");
  }
});

// POST /admin/categories/create
router.post("/create", async (req, res) => {
  try {
    const { key, name_en, name_ar, icon, isActive, sortOrder } = req.body;

    const cleanKey = String(key || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");

    if (!cleanKey) return res.status(400).send("Key is required");
    if (!/^[a-z0-9_]+$/.test(cleanKey)) {
      return res.status(400).send("Key must be lowercase letters, numbers, underscore only.");
    }

    await Category.create({
      key: cleanKey,
      name_en: String(name_en || "").trim(),
      name_ar: String(name_ar || "").trim(),
      icon: String(icon || "").trim(),
      isActive: String(isActive) === "true" || String(isActive) === "on",
      sortOrder: Number(sortOrder) || 0,
    });

    return res.redirect("/admin/categories");
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(400).send("Category key already exists.");
    }
    console.error("❌ Create category:", e);
    return res.status(500).send("Failed to create category: " + (e?.message || e));
  }
});

// POST /admin/categories/update/:id
router.post("/update/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send("Invalid id");

    const { name_en, name_ar, icon, isActive, sortOrder } = req.body;

    await Category.findByIdAndUpdate(id, {
      $set: {
        name_en: String(name_en || "").trim(),
        name_ar: String(name_ar || "").trim(),
        icon: String(icon || "").trim(),
        isActive: String(isActive) === "true" || String(isActive) === "on",
        sortOrder: Number(sortOrder) || 0,
      },
    });

    return res.redirect("/admin/categories");
  } catch (e) {
    console.error("❌ Update category:", e);
    return res.status(500).send("Failed to update category");
  }
});

// POST /admin/categories/toggle/:id
router.post("/toggle/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send("Invalid id");

    const cat = await Category.findById(id);
    if (!cat) return res.status(404).send("Not found");

    cat.isActive = !cat.isActive;
    await cat.save();

    return res.redirect("/admin/categories");
  } catch (e) {
    console.error("❌ Toggle category:", e);
    return res.status(500).send("Failed to toggle category");
  }
});

// POST /admin/categories/delete/:id  (SAFE delete only if unused)
router.post("/delete/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send("Invalid id");

    const cat = await Category.findById(id).lean();
    if (!cat) return res.status(404).send("Not found");

    // Prevent deleting category used by stores/products
    const [storeUsed, productUsed] = await Promise.all([
      Store.exists({ type: cat.key }),
      Product.exists({ category: cat.key }),
    ]);

    if (storeUsed || productUsed) {
      return res
        .status(400)
        .send("Cannot delete: category is used by stores/products. Disable it instead.");
    }

    await Category.findByIdAndDelete(id);
    return res.redirect("/admin/categories");
  } catch (e) {
    console.error("❌ Delete category:", e);
    return res.status(500).send("Failed to delete category");
  }
});

module.exports = router;
