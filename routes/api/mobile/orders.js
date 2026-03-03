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

// helper to compute subtotal from normalized items
function calcItemsSubtotal(items = []) {
  return items.reduce((sum, i) => sum + Number(i.price_snapshot || 0) * Number(i.qty || 1), 0);
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
      const productId =
        rawId && mongoose.Types.ObjectId.isValid(String(rawId))
          ? new mongoose.Types.ObjectId(String(rawId))
          : rawId;

      const storeId =
        x.storeId && mongoose.Types.ObjectId.isValid(String(x.storeId))
          ? new mongoose.Types.ObjectId(String(x.storeId))
          : null;

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
    const firstStoreId = items.find((i) => i.storeId)?.storeId || null;

    // ✅ Pull store coords from DB so pickup is never null
    let pickup = {
      storeId: firstStoreId,
      addressText: "",
      location: { lat: null, lng: null },
    };

    if (firstStoreId) {
      const store = await Store.findById(firstStoreId)
        .select("name addressText address location coordinates geo locationGeo locationLat locationLng lat lng")
        .lean();

      // Try common patterns:
      const sLat =
        toNumOrNull(store?.location?.lat) ??
        toNumOrNull(store?.coordinates?.lat) ??
        toNumOrNull(store?.lat) ??
        toNumOrNull(store?.locationLat);

      const sLng =
        toNumOrNull(store?.location?.lng) ??
        toNumOrNull(store?.coordinates?.lng) ??
        toNumOrNull(store?.lng) ??
        toNumOrNull(store?.locationLng);

      pickup = {
        storeId: firstStoreId,
        addressText: store?.addressText || store?.address || store?.name || "",
        location: { lat: sLat, lng: sLng },
      };
    }

    const subtotal = calcItemsSubtotal(items);

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

      pickup, // ✅ THIS FIXES driver map (store marker/route)

      items,

      totals: {
        subtotal,
        // deliveryFee + total calculated by OrderSchema pre("save")
      },

      delivery: {
        status: "Pending",
      },

      payment: {
        method: "myfatoorah",
        status: "unpaid",
      },
    });

    // ✅ Create notification so Admin Dashboard shows it
    await Notification.create({
      orderId: orderDoc._id,
      message: `🆕 New order from ${customer.name} (${customer.phone})`,
      status: "unpicked",
      driverId: null,
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