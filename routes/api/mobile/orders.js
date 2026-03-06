// routes/api/mobile/orders.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Order = require("../../../models/Order");
const Notification = require("../../../models/Notification");
const Store = require("../../../models/Store"); // ✅ needed to pull pickup coords

function toNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toObjectIdOrNull(v) {
  if (!v) return null;
  const s = String(v);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

// helper to compute subtotal from normalized items
function calcSubtotalFromItems(items = []) {
  return items.reduce((sum, it) => {
    const price = Number(it.price_snapshot ?? 0);
    const qty = Number(it.qty ?? 1);
    return sum + price * qty;
  }, 0);
}

router.post("/create", async (req, res) => {
  console.log("📦 ORDER CREATE HIT:", req.body);

  try {
    const { cartItems, customer } = req.body || {};

    if (!customer?.name || !customer?.phone || !customer?.addressText) {
      return res.status(400).json({ ok: false, error: "Missing customer fields" });
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ ok: false, error: "cartItems is required" });
    }

    // ✅ Customer GPS (from mobile)
    const customerLat = toNumOrNull(customer?.location?.lat);
    const customerLng = toNumOrNull(customer?.location?.lng);

    // ✅ Normalize items (tolerate different shapes)
    const items = cartItems.map((x) => {
      const rawId = x.productId || x._id || x.id;
      const productId = rawId && mongoose.Types.ObjectId.isValid(String(rawId))
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

    // ✅ Auto-pick pickup.storeId from first item that has it
    const pickupStoreId = items.find((i) => i.storeId)?.storeId || null;

    let pickupLocation = { lat: null, lng: null };
    let pickupAddressText = "";

    if (pickupStoreId) {
      const store = await Store.findById(pickupStoreId).lean();

      // Your Store model may store coordinates differently; this supports common patterns:
      const sLat =
        toNumOrNull(store?.location?.lat) ??
        toNumOrNull(store?.coordinates?.lat) ??
        toNumOrNull(store?.coordinates?.[1]) ?? // if [lng,lat] or [lat,lng] adjust below if needed
        null;

      const sLng =
        toNumOrNull(store?.location?.lng) ??
        toNumOrNull(store?.coordinates?.lng) ??
        toNumOrNull(store?.coordinates?.[0]) ??
        null;

      pickupLocation = { lat: sLat, lng: sLng };
      pickupAddressText = store?.address || store?.addressText || store?.name || "";
    }

    const subtotal = calcSubtotalFromItems(items);

    const orderDoc = await Order.create({
      customer: {
        name: String(customer.name).trim(),
        phone: String(customer.phone).trim(),
        addressText: String(customer.addressText).trim(),
        location: { lat: customerLat, lng: customerLng }, // ✅ saved to DB
      },

      pickup: {
        storeId: pickupStoreId,
        addressText: pickupAddressText,
        location: pickupLocation, // ✅ saved to DB (driver needs it)
      },

      items,

      totals: {
        subtotal,
        // deliveryFee + total are calculated by your OrderSchema pre("save")
      },

      delivery: { status: "Pending" },

      payment: { method: "myfatoorah", status: "unpaid" },
    });

    // ✅ Create notification (for admin dashboard)
    await Notification.create({
      orderId: orderDoc._id,
      message: `🆕 New order from ${orderDoc.customer.name} (${orderDoc.customer.phone}) - ${store.name} - Total: QAR ${orderDoc.totals.total}`,
      status: "unpicked",
      driverId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return res.json({ ok: true, orderId: orderDoc._id });
  } catch (err) {
    console.log("❌ /orders/create error:", err?.message);
    console.log(err?.stack);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
