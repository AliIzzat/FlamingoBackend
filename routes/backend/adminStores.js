// routes/backend/adminStores.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const mongoose = require("mongoose");

const Store = require("../../models/Store");
const Category = require("../../models/Category");

// If you have this util already, we will use it
const {
  getActiveCategoryKeys,
  isCategoryActive,
} = require("../../utils/categoryGuard");

/* ---------------------------
   Multer upload
---------------------------- */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "public/uploads/"),
  filename: (_req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
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

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function trimStr(v) {
  return String(v ?? "").trim();
}

function safeObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? id : null;
}

/* =========================================================
   GET /admin/stores
   - Filters + Pagination + Enforce ACTIVE categories only
========================================================= */
router.get("/", async (req, res) => {
  try {
    // Read filters (clean)
    let type = trimStr(req.query.type).toLowerCase();
    const storeId = trimStr(req.query.storeId);
    const q = trimStr(req.query.q);

    // Pagination
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 200);

    // ✅ Load active categories list for dropdown (objects)
    const categories = await Category.find({ isActive: true })
      .sort({ sortOrder: 1, name_en: 1 })
      .lean();

    // ✅ Active keys source of truth
    let activeKeys = [];
    try {
      activeKeys = await getActiveCategoryKeys();
    } catch {
      activeKeys = categories.map((c) => c.key);
    }

    // ✅ Default to restaurant if no type provided
    if (!type) type = "restaurant";

    // ✅ If type is not active => show nothing
    const typeIsValid = activeKeys.includes(type);

    // ✅ BASE FILTER: only active category stores
    const filter = { type: { $in: activeKeys } };

    // ✅ Apply type filter strictly
    if (typeIsValid) {
      filter.type = type;
    } else {
      filter.type = "__none__"; // return nothing
    }

    // ✅ storeId filter
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      filter._id = storeId;
    }

    // ✅ search filter
    if (q) {
      filter.name = { $regex: q, $options: "i" };
    }

    // Count first (for pagination)
    const totalCount = await Store.countDocuments(filter);
    const totalPages = Math.max(Math.ceil(totalCount / limit), 1);
    const safePage = Math.min(page, totalPages);
    const skip = (safePage - 1) * limit;

    // ✅ IMPORTANT:
    // - stores = table data (filtered)
    // - allStores = dropdown options (filtered by type ONLY)
    const [allStores, stores] = await Promise.all([
      Store.find(typeIsValid ? { type } : { type: "__none__" })
        .sort({ name: 1 })
        .lean(),
      Store.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    // Pagination UI window
    const windowSize = 7;
    const start = Math.max(1, safePage - Math.floor(windowSize / 2));
    const end = Math.min(totalPages, start + windowSize - 1);

    const pages = [];
    for (let n = start; n <= end; n++) pages.push({ n, isCurrent: n === safePage });

    // ✅ Keep filters in pagination links
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (storeId) params.set("storeId", storeId);
    if (q) params.set("q", q);
    params.set("limit", String(limit));
    const queryBase = params.toString(); // without "page"

    return res.render("backend/stores", {
      layout: "backend-layout",
      title: "Stores",
      user: req.session.user,

      categories,
      stores,
      allStores,

      selectedType: type || "",
      selectedStoreId: storeId || "",
      searchQuery: q || "",

      currentUrl: req.originalUrl,

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
  } catch (err) {
    console.error("❌ load stores:", err);
    return res.status(500).send("Failed to load stores: " + (err?.message || err));
  }
});

/* =========================================================
   POST /admin/stores/create
========================================================= */
router.post("/create", upload.single("logo"), async (req, res) => {
  try {
    const cleanType = trimStr(req.body.type).toLowerCase();
    const cleanName = trimStr(req.body.name);

    if (!cleanType) return res.status(400).send("type is required");
    if (!cleanName) return res.status(400).send("name is required");

    // ✅ validate category is active
    let ok = false;
    try {
      ok = await isCategoryActive(cleanType);
    } catch {
      const cat = await Category.findOne({ key: cleanType, isActive: true }).lean();
      ok = !!cat;
    }
    if (!ok) return res.status(400).send("Category is invalid or disabled");

    const latNum = toNum(req.body.lat);
    const lngNum = toNum(req.body.lng);

    const doc = {
      type: cleanType,
      name: cleanName,
      name_ar: trimStr(req.body.name_ar),
      address: trimStr(req.body.address),
      logo: req.file ? "/uploads/" + req.file.filename : "",
      isActive: toBool(req.body.isActive, true),
    };

    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      doc.location = { type: "Point", coordinates: [lngNum, latNum] };
    }

    const createdStore = await Store.create(doc);

    // next step
    if (req.body.next === "products") {
      return res.redirect(`/admin/products?storeId=${createdStore._id}`);
    }

    const returnTo = trimStr(req.body.returnTo) || "/admin/stores";
    return res.redirect(returnTo);
  } catch (err) {
    console.error("❌ create store:", err);
    return res.status(500).send("Failed to create store: " + (err?.message || err));
  }
});

/* =========================================================
   POST /admin/stores/update/:id
========================================================= */
router.post("/update/:id", upload.single("logo"), async (req, res) => {
  try {
    const id = safeObjectId(req.params.id);
    if (!id) return res.status(400).send("Invalid store id");

    const cleanType = trimStr(req.body.type).toLowerCase();

    // ✅ validate category is active
    let ok = false;
    try {
      ok = await isCategoryActive(cleanType);
    } catch {
      const cat = await Category.findOne({ key: cleanType, isActive: true }).lean();
      ok = !!cat;
    }
    if (!ok) return res.status(400).send("Category is invalid or disabled");

    const latNum = toNum(req.body.lat);
    const lngNum = toNum(req.body.lng);

    const update = {
      type: cleanType,
      name: trimStr(req.body.name),
      name_ar: trimStr(req.body.name_ar),
      address: trimStr(req.body.address),
      isActive: toBool(req.body.isActive, true),
    };

    if (req.file) update.logo = "/uploads/" + req.file.filename;

    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      update.location = { type: "Point", coordinates: [lngNum, latNum] };
    }

    await Store.findByIdAndUpdate(id, { $set: update }, { runValidators: true });

    const returnTo = trimStr(req.body.returnTo) || "/admin/stores";
    return res.redirect(returnTo);
  } catch (err) {
    console.error("❌ update store:", err);
    return res.status(500).send("Failed to update store: " + (err?.message || err));
  }
});

/* =========================================================
   POST /admin/stores/toggle/:id
========================================================= */
router.post("/toggle/:id", async (req, res) => {
  try {
    const id = safeObjectId(req.params.id);
    if (!id) return res.status(400).send("Invalid store id");

    const store = await Store.findById(id);
    if (!store) return res.status(404).send("Store not found");

    store.isActive = !store.isActive;
    await store.save();

    const returnTo = trimStr(req.body.returnTo) || "/admin/stores";
    return res.redirect(returnTo);
  } catch (err) {
    console.error("❌ toggle store:", err);
    return res.status(500).send("Failed to toggle store: " + (err?.message || err));
  }
});

module.exports = router;
