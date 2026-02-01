// routes/backend/adminProducts.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const mongoose = require("mongoose");

const Category = require("../../models/Category");
const Store = require("../../models/Store");
const Product = require("../../models/Product");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "public/uploads/"),
  filename: (_req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

/* ---------------------------
   Helpers
---------------------------- */
function toBool(v, fallback = true) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).toLowerCase();
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  return fallback;
}
function trimStr(v) {
  return String(v ?? "").trim();
}
function toNumOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function safeObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? id : null;
}

/* =========================================================
   GET /admin/products
   - filters: storeId
   - hides products in disabled categories
   - pagination
========================================================= */
router.get("/", async (req, res) => {
  try {
    const storeId = trimStr(req.query.storeId);

    // Pagination
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 200);
    const skip = (page - 1) * limit;

    // Active categories = source of truth
    const activeCategories = await Category.find({ isActive: true })
      .select("key name_en")
      .sort({ sortOrder: 1, name_en: 1 })
      .lean();
    const activeKeys = activeCategories.map((c) => c.key);

    // Stores dropdown: only stores whose type is active category
    const stores = await Store.find({ isActive: true, type: { $in: activeKeys } })
      .sort({ name: 1 })
      .lean();

    let selectedStore = null;
let filter = {}; // ✅ start empty
console.log("🟦 /admin/products filter =", filter);

if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
  filter.storeId = storeId;
  selectedStore = await Store.findById(storeId).lean();

  // If store category is disabled, treat as none
  if (selectedStore && !activeKeys.includes(selectedStore.type)) {
    selectedStore = null;
    filter = {}; // reset
  }
} else {
  // ✅ only when no store selected, show only active categories
  filter.category = { $in: activeKeys };
}

    const [totalCount, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    const totalPages = Math.max(Math.ceil(totalCount / limit), 1);
    const safePage = Math.min(page, totalPages);

    // Pagination UI window
    const windowSize = 7;
    const start = Math.max(1, safePage - Math.floor(windowSize / 2));
    const end = Math.min(totalPages, start + windowSize - 1);
    const pages = [];
    for (let n = start; n <= end; n++) pages.push({ n, isCurrent: n === safePage });

    // Keep params in pagination links
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    params.set("limit", String(limit));
    const queryBase = params.toString();

    return res.render("backend/products", {
      layout: "backend-layout",      // ✅ force admin layout
      title: "Products",
      user: req.session.user,        // ✅ recommended (for "Logged in as" header)
      stores,
      products,
      selectedStore,
      selectedStoreId: selectedStore?._id?.toString() || "",
      preStoreId: selectedStore?._id?.toString() || "",
      preCategory: selectedStore?.type || "",
      currentUrl: req.originalUrl,
      // pagination
      page: safePage,
      limit,
      totalCount,
      totalPages,
      hasPrev: safePage > 1,
      hasNext: safePage < totalPages,
      prevPage: safePage - 1,
      nextPage: safePage + 1,
      pages,
      queryBase,
    });
  } catch (e) {
    console.error("❌ load products:", e);
    return res.status(500).send("Failed to load products: " + (e?.message || e));
  }
});

/* =========================================================
   GET /admin/products/create
   - optional: redirects to list with preselected storeId
========================================================= */
router.get("/create", async (req, res) => {
  console.log("🔥 HIT /admin/products/create", req.originalUrl);
  console.log("🔥 storeId =", req.query.storeId);

  try {
    const storeId = String(req.query.storeId || "").trim();
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      // fallback: show choose-store page
      const stores = await Store.find({ isActive: true }).sort({ name: 1 }).lean();
      return res.render("backend/products", {
        layout: "backend-layout",
        title: "Add Product",
        user: req.session.user,
        stores,
        selectedStoreId: "",
        error: "No store selected",
      });
    }

    const store = await Store.findById(storeId).lean();
    if (!store) return res.status(404).send("Store not found");

    return res.render("backend/product-form", {
      layout: "backend-layout",
      title: `Add Product • ${store.name}`,
      user: req.session.user,
      store,                 // ✅ pass store object
      selectedStoreId: storeId,
      categoryKey: store.type, // ✅ grocery/restaurant/etc.
      returnTo:
        `/admin/products/category/${store.type}?storeId=${storeId}`,
    });
  } catch (e) {
    console.error("❌ load create product:", e);
    return res.status(500).send("Failed to load create product");
  }
});

/* =========================================================
   POST /admin/products/create
========================================================= */
router.post("/create", upload.single("imageFile"), async (req, res) => {
  try {
    const storeId = safeObjectId(req.body.storeId);
    if (!storeId) return res.status(400).send("Invalid storeId");

    const store = await Store.findById(storeId).lean();
    if (!store) return res.status(400).send("Store not found");

    // Validate store.type is active category
    const cat = await Category.findOne({ key: store.type, isActive: true }).lean();
    if (!cat) return res.status(400).send("Store category is disabled. Enable category first.");

    const name = trimStr(req.body.name || req.body.name_en);
    const name_ar = trimStr(req.body.name_ar);
    if (!name) return res.status(400).send("Name is required");

    const price = toNumOrNull(req.body.price);
    if (price === null) return res.status(400).send("Price must be a valid number");

    const offer = toBool(req.body.offer, false);
    const offerPrice = toNumOrNull(req.body.offerPrice);

    const details = trimStr(req.body.details || req.body.details_en);
    const details_ar = trimStr(req.body.details_ar);

    const image = req.file ? "/uploads/" + req.file.filename : "";

    const payload = {
      category: store.type,
      storeId: store._id,

      name,
      name_ar,
      price,
      image,

      offer,
      offerPrice: offer ? offerPrice : null,

      details,
      details_ar,

      isActive: toBool(req.body.isActive, true),

      storeSnapshot: {
        type: store.type,
        name: store.name,
        name_ar: store.name_ar || "",
        logo: store.logo || "",
        address: store.address || "",
      },
    };

    // optional stockQty (safe even if field removed from UI)
    const stockQty = toNumOrNull(req.body.stockQty);
    if (stockQty !== null) payload.stockQty = stockQty;

    await Product.create(payload);

    const returnTo = trimStr(req.body.returnTo) || `/admin/products?storeId=${storeId}`;
    return res.redirect(returnTo);
  } catch (e) {
    console.error("❌ create product:", e);
    return res.status(500).send("Failed to create product: " + (e?.message || e));
  }
});

/* =========================================================
   GET /admin/products/category/:key
   - blocks disabled categories
   - shows ONLY stores of this category
   - store dropdown => filters products by selected store
========================================================= */
router.get("/category/:key", async (req, res) => {
  console.log("✅ CATEGORY PAGE:", {
  url: req.originalUrl,
  key: req.params.key,
  query: req.query
});
  console.log("🧾 Store collection:", Store.collection.name);
console.log("🧾 DB name:", mongoose.connection.name);

const totalStores = await Store.countDocuments();
console.log("🧾 totalStores:", totalStores);

const anyStore = await Store.findOne({}).lean();
console.log("🧾 anyStore sample:", anyStore);

console.log("🧾 distinct type:", await Store.distinct("type"));
console.log("🧾 distinct isActive:", await Store.distinct("isActive"));
  try {
    const key = trimStr(req.params.key).toLowerCase();
    const storeId = trimStr(req.query.storeId);

    // 1) Validate category exists + active
    const cat = await Category.findOne({ key }).lean();
    if (!cat) return res.status(404).send("Category not found");
    if (!cat.isActive) return res.status(400).send("Category is disabled");

    const titles = {
      restaurant: "Restaurants Meals",
      grocery: "Grocery Products",
      pharmacy: "Pharmacy Products",
      child_care: "Child Care",
      flower: "Flowers",
      nutrition: "Nutrition",
      electronics: "Electronics",
    };

    // 2) Load stores ONLY for this category
    const stores = await Store.find({ type: key, isActive: true })
      .select("name name_ar type logo address")
      .sort({ name: 1 })
      .lean();

    // 3) Determine selected store
    let selectedStoreId = "";
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      // Ensure the store belongs to the same category
      const s = stores.find((x) => String(x._id) === String(storeId));
      if (s) selectedStoreId = String(storeId);
    }

    // Optional: auto-select first store if not chosen
    if (!selectedStoreId && stores.length) {
      selectedStoreId = String(stores[0]._id);
    }

    // 4) Load products only for selected store
    let products = [];
    if (selectedStoreId) {
     products = await Product.find({
     storeId: selectedStoreId,
      })
    .sort({ createdAt: -1 })
    .lean();
    }

    console.log("✅ STORES:", stores.length, "key:", key);
    console.log("✅ PRODUCTS:", products.length, "selectedStoreId:", selectedStoreId);


    return res.render("backend/products-category", {
      layout: "backend-layout",
      pageTitle: titles[key] || key,
      categoryKey: key,
      stores,
      selectedStoreId,
      products,
      user: req.session.user,
    });
  } catch (e) {
    console.error("❌ category page:", e);
    return res.status(500).send("Failed to load category products: " + (e?.message || e));
  }
});

/* =========================================================
   POST /admin/products/update/:id
========================================================= */
router.post("/:id/image", upload.single("imageFile"), async (req, res) => {
  const id = req.params.id;
  const imgPath = req.file ? `/uploads/products/${req.file.filename}` : "";

  await Product.findByIdAndUpdate(id, { image: imgPath });
  return res.redirect("back");
});



router.post("/update/:id", upload.single("image"), async (req, res) => {
  console.log("🟢 HIT UPDATE ROUTE:", req.originalUrl, "id:", req.params.id);
  try {
    const id = safeObjectId(req.params.id);
    if (!id) return res.status(400).send("Invalid product id");

    const existing = await Product.findById(id).lean();
    if (!existing) return res.status(404).send("Product not found");

    const store = await Store.findById(existing.storeId)
     .select("type").lean();  

    if (!store) {
      return res.status(400).send("Store not found");
    }

    const name = trimStr(req.body.name || req.body.name_en);
    if (!name) return res.status(400).send("Name is required");

    const price = toNumOrNull(req.body.price);
    if (price === null) return res.status(400).send("Price must be a valid number");

    const offer = toBool(req.body.offer, false);
    const offerPrice = toNumOrNull(req.body.offerPrice);

    const update = {
      name,
      name_ar: trimStr(req.body.name_ar),
      details: trimStr(req.body.details || req.body.details_en),
      details_ar: trimStr(req.body.details_ar),

      price,
      offer,
      offerPrice: offer ? offerPrice : null,

      isActive: toBool(req.body.isActive, true),
      category: store.type,
       // ✅ KEEP SNAPSHOT CONSISTENT
      "storeSnapshot.type": store.type,
    };

   console.log("🟢 store.type =", store.type);
   console.log("🟢 before category =", existing.category, "before snapshot.type =", existing.storeSnapshot?.type);

    const after = await Product.findById(id).select("category storeSnapshot.type").lean();
    console.log("🟩 after.category =", after.category, "snapshot.type =", after.storeSnapshot?.type);

    const stockQty = toNumOrNull(req.body.stockQty);
    if (stockQty !== null) update.stockQty = stockQty;

    if (req.file) update.image = "/uploads/" + req.file.filename;

    await Product.findByIdAndUpdate(id, { $set: update }, { runValidators: true });

    const returnTo =
      trimStr(req.body.returnTo) || `/admin/products?storeId=${existing.storeId.toString()}`;
    return res.redirect(returnTo);
  } catch (e) {
    console.error("❌ update product:", e);
    return res.status(500).send("Failed to update product: " + (e?.message || e));
  }
});

/* =========================================================
   POST /admin/products/toggle/:id
========================================================= */
router.post("/toggle/:id", async (req, res) => {
  try {
    const id = safeObjectId(req.params.id);
    if (!id) return res.status(400).send("Invalid product id");

    const p = await Product.findById(id);
    if (!p) return res.status(404).send("Product not found");

    p.isActive = !p.isActive;
    await p.save();

    const returnTo =
      trimStr(req.body.returnTo) || `/admin/products?storeId=${p.storeId.toString()}`;
    return res.redirect(returnTo);
  } catch (e) {
    console.error("❌ toggle product:", e);
    return res.status(500).send("Failed to toggle product: " + (e?.message || e));
  }
});

/* =========================================================
   POST /admin/products/delete/:id
========================================================= */
router.post("/delete/:id", async (req, res) => {
  try {
    const id = safeObjectId(req.params.id);
    if (!id) return res.status(400).send("Invalid product id");

    const p = await Product.findById(id).lean();
    if (!p) return res.status(404).send("Product not found");

    await Product.findByIdAndDelete(id);

    const returnTo =
      trimStr(req.body.returnTo) || `/admin/products?storeId=${p.storeId.toString()}`;
    return res.redirect(returnTo);
  } catch (e) {
    console.error("❌ delete product:", e);
    return res.status(500).send("Failed to delete product: " + (e?.message || e));
  }
});

module.exports = router;

