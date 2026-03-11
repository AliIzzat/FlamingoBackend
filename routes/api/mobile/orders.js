// routes/api/mobile/orders.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Order = require("../../../models/Order");
const Notification = require("../../../models/Notification");
const Store = require("../../../models/Store");

// -------------------------
// Helpers
// -------------------------
function toNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toObjectIdOrNull(v) {
  if (!v) return null;
  const s = String(v);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

function calcSubtotalFromItems(items = []) {
  return items.reduce((sum, x) => {
    const price = Number(x.price_snapshot || 0);
    const qty = Number(x.qty || 1);
    return sum + price * qty;
  }, 0);
}

function normalizeItemsForFingerprint(cartItems = []) {
  return [...cartItems]
    .map((x) => ({
      id: String(x.id || x.productId || x._id || ""),
      storeId: String(x.storeId || ""),
      qty: Number(x.quantity ?? x.qty ?? 1),
      price: Number(x.price ?? x.price_snapshot ?? 0),
      type: String(x.type || x.category || "product"),
    }))
    .sort((a, b) =>
      `${a.storeId}:${a.id}:${a.type}`.localeCompare(`${b.storeId}:${b.id}:${b.type}`)
    );
}

function fingerprintOrder({ cartItems = [], phone = "" }) {
  return JSON.stringify({
    phone: String(phone || "").trim(),
    items: normalizeItemsForFingerprint(cartItems),
  });
}

// -------------------------
// CREATE ORDER
// POST /api/mobile/orders/create
// -------------------------
router.post("/create", async (req, res) => {
  console.log("📦 ORDER CREATE HIT:", req.body);

  try {
    const { cartItems, customer } = req.body || {};

    if (!customer?.name || !customer?.phone || !customer?.addressText) {
      return res.status(400).json({
        ok: false,
        error: "Missing customer fields",
      });
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "cartItems is required",
      });
    }

    // ✅ duplicate recent-order guard
    const newFingerprint = fingerprintOrder({
      cartItems,
      phone: customer.phone,
    });

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const recentOrders = await Order.find({
      "customer.phone": String(customer.phone).trim(),
      createdAt: { $gte: tenMinutesAgo },
    }).lean();

    const duplicate = recentOrders.find((o) => {
      const existingFingerprint = JSON.stringify({
        phone: String(o.customer?.phone || "").trim(),
        items: [...(o.items || [])]
          .map((it) => ({
            id: String(it.productId || ""),
            storeId: String(it.storeId || ""),
            qty: Number(it.qty || 1),
            price: Number(it.price_snapshot || 0),
            type: String(it.category || "product"),
          }))
          .sort((a, b) =>
            `${a.storeId}:${a.id}:${a.type}`.localeCompare(`${b.storeId}:${b.id}:${b.type}`)
          ),
      });

      return (
        existingFingerprint === newFingerprint &&
        (
          o.payment?.status === "paid" ||
          o.checkout?.isFinalized === true ||
          o.delivery?.status === "Pending"
        )
      );
    });

    if (duplicate) {
      return res.status(409).json({
        ok: false,
        error: "A similar recent order already exists",
        existingOrderId: duplicate._id,
      });
    }

    // ✅ customer GPS
    const customerLat = toNumOrNull(customer?.location?.lat);
    const customerLng = toNumOrNull(customer?.location?.lng);

    // ✅ normalize items
    const items = cartItems.map((x) => {
      const rawId = x.productId || x._id || x.id;

      const productId =
        rawId && mongoose.Types.ObjectId.isValid(String(rawId))
          ? new mongoose.Types.ObjectId(String(rawId))
          : rawId;

      const storeId = toObjectIdOrNull(x.storeId);

      return {
        productId,
        category: x.type || x.category || "restaurant",
        name_snapshot: x.name || x.name_snapshot || "Item",
        price_snapshot: Number(x.price ?? x.price_snapshot ?? 0),
        qty: Number(x.quantity ?? x.qty ?? 1),
        storeId,
        image_snapshot: x.image || x.image_snapshot || "",
      };
    });

    // ✅ pickup store from first item
    const pickupStoreId = items.find((i) => i.storeId)?.storeId || null;

    let pickupLocation = { lat: null, lng: null };
    let pickupAddressText = "";
    let storeName = "Store";

    if (pickupStoreId) {
      const store = await Store.findById(pickupStoreId).lean();

      storeName = store?.name || "Store";

      // ✅ Read store coordinates correctly
        const sLat =
          toNumOrNull(store?.latitude) ??
          toNumOrNull(store?.location?.coordinates?.[1]) ??
          null;

        const sLng =
          toNumOrNull(store?.longitude) ??
          toNumOrNull(store?.location?.coordinates?.[0]) ??
          null;
      
      pickupLocation = { lat: sLat, lng: sLng };
      pickupAddressText = store?.address || store?.addressText || store?.name || "";
    }

    const subtotal = calcSubtotalFromItems(items);
    // See a debug message 
    console.log("🧾 normalized items =", JSON.stringify(items, null, 2));
    console.log("🏪 pickupStoreId =", String(pickupStoreId || ""));
    console.log("🏪 store doc =", JSON.stringify(store || null, null, 2));
    console.log("📍 resolved pickup =", pickupLocation);

    const orderDoc = await Order.create({
      customer: {
        name: String(customer.name).trim(),
        phone: String(customer.phone).trim(),
        addressText: String(customer.addressText).trim(),
        location: {
          lat: customerLat,
          lng: customerLng,
        },
      },

      pickup: {
        storeId: pickupStoreId,
        addressText: pickupAddressText,
        location: pickupLocation,
      },

      items,

      totals: {
        subtotal,
        // total + deliveryFee handled by OrderSchema pre("save")
      },

      delivery: {
        status: "Pending",
      },

      payment: {
        method: "myfatoorah",
        status: "unpaid",
      },

      checkout: {
        isFinalized: false,
        finalizedAt: null,
      },
    });

    const total = Number(orderDoc?.totals?.total || subtotal || 0).toFixed(2);

    // ✅ admin notification
    await Notification.create({
      orderId: orderDoc._id,
      message: `🆕 ${storeName} | ${orderDoc.customer.name} (${orderDoc.customer.phone}) | QAR ${total}`,
      status: "unpicked",
      driverId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return res.json({
      ok: true,
      orderId: orderDoc._id,
    });
  } catch (err) {
    console.log("❌ /orders/create error:", err?.message);
    console.log(err?.stack);
    return res.status(500).json({
      ok: false,
      error: "Server error",
    });
  }
});

module.exports = router;




// const sLat =
      //   toNumOrNull(store?.location?.lat) ??
      //   toNumOrNull(store?.coordinates?.lat) ??
      //   toNumOrNull(store?.coordinates?.[1]) ??
      //   null;

      // const sLng =
      //   toNumOrNull(store?.location?.lng) ??
      //   toNumOrNull(store?.coordinates?.lng) ??
      //   toNumOrNull(store?.coordinates?.[0]) ??
      //   null;