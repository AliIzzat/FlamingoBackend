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

router.post("/create", async (req, res) => {
  try {
    const { cartItems, customer } = req.body;

    // ✅ Validate customer
    if (!customer?.name || !customer?.phone || !customer?.addressText) {
      return res.status(400).json({
        ok: false,
        error: "Missing customer fields",
        required: ["customer.name", "customer.phone", "customer.addressText"],
      });
    }

    // ✅ Validate cart items
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ ok: false, error: "cartItems is required" });
    }

    // ✅ Map cartItems → Order.items (YOUR schema)
    const items = cartItems.map((x) => {
      const productId = x.productId || x.id;
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new Error(`Invalid productId: ${productId}`);
      }

      const qty = Number(x.quantity ?? x.qty ?? 1);
      if (!qty || qty < 1) {
        throw new Error(`Invalid qty for productId ${productId}`);
      }

      const price = Number(x.price ?? x.price_snapshot ?? 0);

      return {
        productId,
        storeId: x.storeId && mongoose.Types.ObjectId.isValid(x.storeId) ? x.storeId : null,
        category: x.category || x.storeType || x.type || "unknown", // must be String
        name_snapshot: x.name || x.name_snapshot || "Item",
        price_snapshot: price,
        qty,
        image_snapshot: x.image || "",
      };
    });

    // ✅ totals.subtotal is what your pre("save") uses
    const subtotal = calcSubtotal(cartItems);

    // ✅ optional: pickup info (if you have it)
    // If you don't have pickup yet, leave it blank safely.
    const pickup = req.body.pickup || undefined;

    const orderDoc = await Order.create({
      customer: {
        name: customer.name,
        phone: customer.phone,
        addressText: customer.addressText,
        location: customer.location || { lat: null, lng: null },
      },

      ...(pickup ? { pickup } : {}),

      items,

      totals: {
        subtotal, // ✅ pre-save will compute deliveryFee + total
      },

      // ✅ real order status in your schema:
      delivery: {
        status: "Pending",
      },

      // ✅ payment block (optional; defaults exist in schema)
      payment: {
        method: "myfatoorah",
        status: "unpaid",
      },
    });

    return res.json({ ok: true, orderId: orderDoc._id });
  } catch (err) {
    console.log("❌ /orders/create error:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      message: err.message,
    });
  }
});

module.exports = router;
