const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Order = require("../../../models/Order");

// helper to compute subtotal from cartItems
function calcSubtotal(cartItems = []) {
  return cartItems.reduce((sum, x) => {
    const price = Number(x.price ?? x.price_snapshot ?? 0);
    const qty = Number(x.quantity ?? x.qty ?? 1);
    return sum + price * qty;
  }, 0);
}

function toNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

router.post("/create", async (req, res) => {
  console.log("📦 ORDER CREATE HIT:", req.body);

  try {
    const { cartItems, customer } = req.body || {};

    if (!customer?.name || !customer?.phone || !customer?.addressText) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing customer fields" });
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ ok: false, error: "cartItems is required" });
    }

    // ✅ Extract coords if provided (from app)
    const lat = toNumOrNull(customer?.location?.lat);
    const lng = toNumOrNull(customer?.location?.lng);

    const items = cartItems.map((x) => {
      const rawId = x.productId || x._id || x.id; // ✅ tolerate different shapes
      const productId =
        rawId && mongoose.Types.ObjectId.isValid(String(rawId))
          ? new mongoose.Types.ObjectId(String(rawId))
          : rawId; // if not ObjectId, store as-is (but ideally it IS ObjectId)

      return {
        productId,
        category: x.type || x.category || "restaurant",
        name_snapshot: x.name || x.name_snapshot || "Item",
        price_snapshot: Number(x.price ?? x.price_snapshot ?? 0),
        qty: Number(x.quantity ?? x.qty ?? 1),
        storeId:
          x.storeId && mongoose.Types.ObjectId.isValid(String(x.storeId))
            ? new mongoose.Types.ObjectId(String(x.storeId))
            : null,
        image_snapshot: x.image || x.image_snapshot || "",
      };
    });

    const subtotal = calcSubtotal(cartItems);

    const orderDoc = await Order.create({
      customer: {
        name: String(customer.name).trim(),
        phone: String(customer.phone).trim(),
        addressText: String(customer.addressText).trim(),
        location: {
          lat,
          lng,
        },
      },
      items,
      totals: {
        subtotal,
        // deliveryFee + total are calculated by your OrderSchema pre("save")
      },
      delivery: {
        status: "Pending",
      },
      payment: {
        method: "myfatoorah",
        status: "unpaid",
      },
    });

    return res.json({ ok: true, orderId: orderDoc._id });
  } catch (err) {
    console.log("❌ /orders/create error:", err?.message);
    console.log(err?.stack);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});
module.exports = router;
