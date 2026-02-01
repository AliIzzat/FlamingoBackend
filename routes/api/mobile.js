// routes/api/mobile.js
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const router = express.Router();

const Category = require("../../models/Category");
const Store = require("../../models/Store");
const Product = require("../../models/Product");
const Order = require("../../models/Order");

// -----------------------------
// Env
// -----------------------------
const MYFATOORAH_API_KEY = process.env.MYFATOORAH_API_KEY;
const MYFATOORAH_BASE = process.env.MYFATOORAH_API_BASE || "https://apitest.myfatoorah.com";
const SUCCESS_URL = process.env.MYFATOORAH_SUCCESS_URL;
const ERROR_URL = process.env.MYFATOORAH_ERROR_URL;

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

// -----------------------------
// Health check
// -----------------------------
router.get("/ping", (_req, res) => {
  res.json({ ok: true, message: "Mobile API alive" });
});

// -----------------------------
// GET /api/mobile/categories
// -----------------------------
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
// GET /api/mobile/stores?category=flower
// category == Store.type
// -----------------------------
router.get("/stores", async (req, res) => {
  try {
    const category = String(req.query.category || "").trim().toLowerCase();
    if (!category) {
      return res.status(400).json({ ok: false, message: "category is required" });
    }

    const stores = await Store.find({ type: category, isActive: true })
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
// GET /api/mobile/products?storeId=...
// -----------------------------
router.get("/products", async (req, res) => {
  try {
    const storeId = String(req.query.storeId || "").trim();
    if (!isValidObjectId(storeId)) {
      return res.status(400).json({ ok: false, message: "Valid storeId is required" });
    }

    const products = await Product.find({ storeId, isActive: true })
      .select("name name_ar price image offer offerPrice details details_ar storeId category storeSnapshot")
      .sort({ createdAt: -1 })
      .lean();

    res.json({ ok: true, products });
  } catch (e) {
    console.error("❌ mobile products:", e);
    res.status(500).json({ ok: false, message: "Failed to load products" });
  }
});

// -----------------------------
router.post("/checkout", async (req, res) => {
  try {
    const { storeId, items, customer, source } = req.body;

    if (!isValidObjectId(storeId)) {
      return res.status(400).json({ ok: false, message: "Valid storeId is required" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: "Cart is empty" });
    }

    const store = await Store.findById(storeId).select("name type isActive").lean();
    if (!store || !store.isActive) {
      return res.status(404).json({ ok: false, message: "Store not found / inactive" });
    }

    // 1) Load product prices from DB (server is source of truth)
    const productIds = items
      .map((i) => i.productId || i.mealId)
      .filter(Boolean)
      .map(String);

    const validObjectIds = productIds.filter(isValidObjectId);
    if (validObjectIds.length === 0) {
      return res.status(400).json({ ok: false, message: "No valid productIds" });
    }

    const dbProducts = await Product.find({
      _id: { $in: validObjectIds },
      storeId,
      isActive: true,
    })
      .select("_id name name_ar price offer offerPrice image")
      .lean();

    const dbMap = new Map(dbProducts.map((p) => [String(p._id), p]));

    // 2) Build order items + compute total
    let totalAmount = 0;
    const orderItems = [];

    for (const i of items) {
      const id = String(i.productId || i.mealId || "");
      const qty = Math.max(Number(i.quantity || 1), 1);

      const p = dbMap.get(id);
      if (!p) {
        return res.status(400).json({ ok: false, message: `Invalid product in cart: ${id}` });
      }

      const unitPrice =
        p.offer && Number.isFinite(Number(p.offerPrice)) && Number(p.offerPrice) > 0
          ? Number(p.offerPrice)
          : Number(p.price);

      totalAmount += unitPrice * qty;

      orderItems.push({
        productId: p._id,
        name: p.name,
        price: unitPrice,
        quantity: qty,
      });
    }

    totalAmount = Math.round(totalAmount * 100) / 100;

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid total" });
    }

    // 3) Create order first
    const order = await Order.create({
      storeId,
      storeType: store.type, // only if your schema supports it
      items: orderItems,
      customerName: customer?.name || "",
      customerPhone: customer?.phone || "",
      customerAddress: customer?.address || "",
      customerLat: customer?.lat ?? null,
      customerLng: customer?.lng ?? null,
      totalAmount,
      status: "PendingPayment",
      source: source || "mobile",
    });

    // 4) MyFatoorah
    if (!MYFATOORAH_API_KEY) {
      return res.status(500).json({ ok: false, message: "MyFatoorah API key missing" });
    }
    if (!SUCCESS_URL || !ERROR_URL) {
      return res.status(500).json({ ok: false, message: "MyFatoorah callback URLs missing" });
    }

    const mfPayload = {
      InvoiceValue: totalAmount,
      CustomerName: customer?.name || "Customer",
      CustomerMobile: customer?.phone || "",
      CallBackUrl: SUCCESS_URL,
      ErrorUrl: ERROR_URL,
      UserDefinedField: String(order._id),
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
        $set: { status: "PaymentFailed", paymentError: mfData },
      });
      return res.status(500).json({ ok: false, message: "Failed to create payment" });
    }

    const paymentUrl = mfData.Data?.InvoiceURL || mfData.Data?.PaymentURL;
    const invoiceId = mfData.Data?.InvoiceId ?? null;

    await Order.findByIdAndUpdate(order._id, {
      $set: {
        invoiceId,
        paymentUrl,
        status: "PendingPayment",
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
router.get("/payment/success", async (req, res) => {
  try {
    const orderId = String(
      req.query.orderId ||
      req.query.UserDefinedField ||
      req.query.InvoiceId || ""
    );

    if (isValidObjectId(orderId)) {
      await Order.findByIdAndUpdate(orderId, {
        $set: { status: "Paid" },
      });
    }

    // redirect back to CUSTOMER app
    return res.redirect("flamingdelivery://payment-success");
  } catch (e) {
    console.error("❌ payment success callback:", e);
    return res.redirect("flamingdelivery://payment-failed");
  }
});

router.get("/payment/error", async (req, res) => {
  try {
    const orderId = String(
      req.query.orderId ||
      req.query.UserDefinedField ||
      req.query.InvoiceId || ""
    );

    if (isValidObjectId(orderId)) {
      await Order.findByIdAndUpdate(orderId, {
        $set: { status: "PaymentFailed" },
      });
    }

    return res.redirect("flamingdelivery://payment-failed");
  } catch (e) {
    console.error("❌ payment error callback:", e);
    return res.redirect("flamingdelivery://payment-failed");
  }
});

module.exports = router;
