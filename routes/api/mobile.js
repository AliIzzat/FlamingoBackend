// routes/api/mobile.js
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const router = express.Router();
const Meal = require("../../models/Meals");      // mapped to collection "foods"

const Category = require("../../models/Category");
const Store = require("../../models/Store");
const Order = require("../../models/Order");
// -------Env-------------------
const MYFATOORAH_API_KEY = process.env.MYFATOORAH_API_KEY;
const MYFATOORAH_BASE = process.env.MYFATOORAH_API_BASE || "https://apitest.myfatoorah.com";
const SUCCESS_URL = process.env.MYFATOORAH_SUCCESS_URL;
const ERROR_URL = process.env.MYFATOORAH_ERROR_URL;

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}
//----------- Health check---------
router.get("/ping", (_req, res) => {
  res.json({ ok: true, message: "Mobile API alive" });
});

// GET /api/mobile/offers?limit=30
router.get("/offers", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 30), 100);

    // pull offers from both collections
    const [mealOffers, productOffers] = await Promise.all([
      Meal.find({ offer: true })
        .select("name price offer offerPrice image restaurant storeId")
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(limit)
        .lean(),

      Product.find({ offer: true, isActive: true })
        .select("name price offer offerPrice image storeId category")
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    // normalize into one shape for the mobile app
    const normalizedMeals = mealOffers.map((m) => ({
      _id: m._id,
      kind: "meal",
      name: m.name,
      price: m.price,
      offer: !!m.offer,
      offerPrice: m.offerPrice ?? null,
      image: m.image || "",
      restaurant: m.restaurant ?? null,
      storeId: m.storeId ?? null,
    }));

    const normalizedProducts = productOffers.map((p) => ({
      _id: p._id,
      kind: "product",
      name: p.name,
      price: p.price,
      offer: !!p.offer,
      offerPrice: p.offerPrice ?? null,
      image: p.image || "",
      storeId: p.storeId ?? null,
      category: p.category ?? null,
    }));

    // merge + shuffle/sort (simple: newest first)
    const combined = [...normalizedMeals, ...normalizedProducts]
      .sort((a, b) => String(b._id).localeCompare(String(a._id)))
      .slice(0, limit);

    return res.json({ ok: true, offers: combined });
  } catch (e) {
    console.error("❌ mobile offers:", e);
    return res.status(500).json({ ok: false, message: "Failed to load offers" });
  }
});

// ---------GET /api/mobile/categories--------
router.get("/categories", async (_req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .select("key name_en name_ar icon sortOrder")
      .sort({ sortOrder: 1, name_en: 1 })
      .lean();

    res.json({ ok: true, categories });
  } catch (e) {
    console.error("❌ mobile categories:", e);
    res.status(500).json({ ok: false, message: "Failed to load categories" });
  }
});

// -----------------------------
// GET /api/mobile/meals?category=restaurant&offer=true&limit=30&storeId=...
// meals are Products where category="restaurant"
// -----------------------------

// GET /api/mobile/meals?limit=30
// GET /api/mobile/meals?offer=true&limit=30
router.get("/meals", async (req, res) => {
  try {
    const Product = require("../../models/Product");

    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const offer = String(req.query.offer || "").toLowerCase() === "true";

    const q = {
      isActive: true,
      "storeSnapshot.type": "restaurant",
    };
    if (offer) q.offer = true;

    const meals = await Product.find(q)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, meals });
  } catch (err) {
    console.error("❌ GET /api/mobile/meals:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});


// routes/api/mobile.js  (or routes/api/mobile/meals.js)
// router.get("/meals", async (req, res) => {
//   const limit = Math.min(Number(req.query.limit) || 30, 100);
//   const offer = String(req.query.offer || "").toLowerCase() === "true";

//   const q = {
//     isActive: true,
//     "storeSnapshot.type": "restaurant",
//   };

//   if (offer) q.offer = true;

//   const meals = await Product.find(q)
//     .sort({ createdAt: -1 })
//     .limit(limit)
//     .lean();

//   return res.json({ ok: true, meals });
// });
// -----------------------------
// GET /api/mobile/offers?limit=30&category=restaurant
// Offers = Products where offer=true (optionally filter by category)
// -----------------------------
router.get("/offers", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "30", 10), 100);
    const category = String(req.query.category || "").trim().toLowerCase();

    const filter = { offer: true, isActive: true };
    if (category) filter.category = category;

    const offers = await Product.find(filter)
      .select("category storeId storeSnapshot name name_ar price image offer offerPrice")
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, offers });
  } catch (e) {
    console.error("❌ mobile offers:", e);
    return res.status(500).json({ ok: false, message: "Failed to load offers" });
  }
});


// --GET /api/mobile/stores?category=flower--
// -----------category == Store.type----------
router.get("/stores", async (req, res) => {
  try {
    const category = String(req.query.category || "").trim().toLowerCase();
    if (!category) {
      return res.status(400).json({ ok: false, message: "category is required" });
    }
    const stores = await Store.find({
      type: { $regex: new RegExp(`^${category}$`, "i") }, // case-insensitive exact match
      $or: [{ isActive: true }, { isActive: { $exists: false } }],
    })
  .select("name name_ar type logo address latitude longitude location isActive")
  .sort({ name: 1 })
  .lean();

    res.json({ ok: true, stores });
  } catch (e) {
    console.error("❌ mobile stores:", e);
    res.status(500).json({ ok: false, message: "Failed to load stores" });
  }
});
// -----------------------------
router.post("/checkout", async (req, res) => {
  try {
    const { storeId, items, customer } = req.body;

    // ✅ Validate
    if (!isValidObjectId(storeId)) {
      return res.status(400).json({ ok: false, message: "Valid storeId is required" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: "Cart is empty" });
    }

    const name = String(customer?.name || "").trim();
    const phone = String(customer?.phone || "").trim();
    const addressText = String(customer?.addressText || "").trim();

    if (!name) return res.status(400).json({ ok: false, message: "Customer name is required" });
    if (!phone) return res.status(400).json({ ok: false, message: "Customer phone is required" });
    if (!addressText) return res.status(400).json({ ok: false, message: "Customer address is required" });

    // ✅ Store
    const store = await Store.findById(storeId)
      .select("name type isActive address latitude longitude location")
      .lean();

    if (!store || !store.isActive) {
      return res.status(404).json({ ok: false, message: "Store not found / inactive" });
    }

    // ✅ Load products from DB (source of truth)
    const productIds = items
      .map((i) => String(i.productId || i.mealId || ""))
      .filter((id) => isValidObjectId(id));

    if (productIds.length === 0) {
      return res.status(400).json({ ok: false, message: "No valid productIds" });
    }

    const dbProducts = await Product.find({
      _id: { $in: productIds },
      storeId,
      isActive: true,
    })
      .select("_id name price offer offerPrice image storeId storeSnapshot category")
      .lean();

    const dbMap = new Map(dbProducts.map((p) => [String(p._id), p]));

    // ✅ Build order.items snapshots + subtotal
    let subtotal = 0;
    const orderItems = [];

    for (const i of items) {
      const id = String(i.productId || i.mealId || "");
      const p = dbMap.get(id);
      if (!p) {
        return res.status(400).json({ ok: false, message: `Invalid product in cart: ${id}` });
      }

      const qty = Math.max(Number(i.qty ?? i.quantity ?? 1), 1);

      const unitPrice =
      p.offer && Number(p.offerPrice) > 0 ? Number(p.offerPrice) : Number(p.price);
      subtotal += unitPrice * qty;

      orderItems.push({
        productId: p._id,
        storeId: p.storeId ?? storeId,
        category: store.type, // ✅ always store.type (single source of truth)
        name_snapshot: p.name,
        price_snapshot: unitPrice,
        qty,
        image_snapshot: p.image || "",
      });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    if (!Number.isFinite(subtotal) || subtotal <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid subtotal" });
    }

    // ✅ Pickup coords from Store (support both styles)
    const pickupLng = store.location?.coordinates?.[0] ?? store.longitude ?? null;
    const pickupLat = store.location?.coordinates?.[1] ?? store.latitude ?? null;

    // ✅ Create Order (matches your schema)
    const order = await Order.create({
      customer: {
        name,
        phone,
        addressText,
        location: {
          lat: customer?.lat ?? null,
          lng: customer?.lng ?? null,
        },
      },
      pickup: {
        storeId,
        addressText: store.address || "",
        location: { lat: pickupLat, lng: pickupLng },
      },
      items: orderItems,
      totals: { subtotal }, // deliveryFee + total computed in pre-save
      payment: { method: "myfatoorah", status: "unpaid" },
      delivery: { status: "Pending", assignedDriverId: null },
      dispute: { status: "None" },
    });

    // ✅ MyFatoorah config
    if (!MYFATOORAH_API_KEY) {
      return res.status(500).json({ ok: false, message: "MyFatoorah API key missing" });
    }
    if (!SUCCESS_URL || !ERROR_URL) {
      return res.status(500).json({ ok: false, message: "MyFatoorah callback URLs missing" });
    }

    // IMPORTANT: InvoiceValue should be the FINAL total (subtotal + delivery fee)
    const invoiceValue = Number(order.totals?.total || subtotal);

    const mfPayload = {
      InvoiceValue: invoiceValue,
      CustomerName: name,
      CustomerMobile: phone,
      CallBackUrl: SUCCESS_URL,
      ErrorUrl: ERROR_URL,
      UserDefinedField: String(order._id), // ✅ orderId lives here
      DisplayCurrencyIso: "QAR",
    };

    const mfRes = await axios.post(`${MYFATOORAH_BASE}/v2/SendPayment`, mfPayload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MYFATOORAH_API_KEY}`,
      },
      timeout: 20000,
    });

    const mfData = mfRes.data;

    if (!mfData?.IsSuccess) {
      console.error("❌ MyFatoorah failed:", mfData);
      await Order.findByIdAndUpdate(order._id, {
        $set: { "payment.status": "failed" },
      });
      return res.status(500).json({ ok: false, message: "Failed to create payment" });
    }
    const paymentUrl = mfData.Data?.InvoiceURL || mfData.Data?.PaymentURL;
    const invoiceId = String(mfData.Data?.InvoiceId || "");
    const paymentId = String(mfData.Data?.PaymentId || "");

    await Order.findByIdAndUpdate(order._id, {
      $set: {
        "payment.invoiceId": invoiceId,
        "payment.paymentId": paymentId,
      },
    });

    return res.json({
      ok: true,
      orderId: String(order._id),
      paymentUrl,
      invoiceId,
    });
  } catch (e) {
    console.error("❌ mobile checkout:", e);
    return res.status(500).json({ ok: false, message: "Checkout error" });
  }
});

// MyFatoorah success callback
router.get("/payment/success", async (req, res) => {
  try {
    // ✅ orderId was stored in UserDefinedField
    const orderId = String(req.query.UserDefinedField || req.query.orderId || "");
    if (isValidObjectId(orderId)) {
      await Order.findByIdAndUpdate(orderId, {
        $set: { "payment.status": "paid" },
      });
    }

    return res.redirect("FlamingDeliverySys://payment-success");
  } catch (e) {
    console.error("❌ payment success callback:", e);
    return res.redirect("FlamingDeliverySys://payment-failed");
  }
});

// MyFatoorah error callback
router.get("/payment/error", async (req, res) => {
  try {
    const orderId = String(req.query.UserDefinedField || req.query.orderId || "");
    if (isValidObjectId(orderId)) {
      await Order.findByIdAndUpdate(orderId, {
        $set: { "payment.status": "failed" },
      });
    }

    return res.redirect("FlamingDeliverySys://payment-failed");
  } catch (e) {
    console.error("❌ payment error callback:", e);
    return res.redirect("FlamingDeliverySys://payment-failed");
  }
});


module.exports = router;
