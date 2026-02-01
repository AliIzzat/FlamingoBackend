const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Order = require("../../models/Order");

// TEMP auth for now: Header: x-customer-phone: 50000000
// Replace later with JWT/session
function requireCustomer(req, res, next) {
  const phone = req.header("x-customer-phone");
  if (!phone) return res.status(401).json({ ok: false, error: "Missing x-customer-phone" });
  req.customerPhone = String(phone).trim();
  next();
}

// Read dispute window from env (default 24h if missing or invalid)
const DISPUTE_WINDOW_HOURS = Number(process.env.DISPUTE_WINDOW_HOURS) || 24;

// POST /api/customer/disputes/:orderId
router.post("/:orderId", requireCustomer, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason, notesCustomer } = req.body;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ ok: false, error: "Invalid order id" });
    }

    // Ensure delivered + belongs to customer
    const order = await Order.findOne({
      _id: orderId,
      "delivery.status": "Delivered",
      "customer.phone": req.customerPhone,
    });

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: "Order not found, not delivered, or not owned by this customer.",
      });
    }

    // Prevent duplicate disputes
    if (order.dispute?.status && order.dispute.status !== "None") {
      return res.status(409).json({
        ok: false,
        error: "Dispute already exists for this order.",
      });
    }

    // ✅ Dispute time window (configurable)
    const deliveredAt = order?.delivery?.deliveredAt;

    if (!deliveredAt) {
      return res.status(400).json({
        ok: false,
        error: "Delivery time missing (deliveredAt). Cannot open dispute.",
      });
    }

    const ageMs = Date.now() - deliveredAt.getTime();
    const maxMs = DISPUTE_WINDOW_HOURS * 60 * 60 * 1000;

    if (DISPUTE_WINDOW_HOURS <= 0 || ageMs > maxMs) {
      return res.status(403).json({
        ok: false,
        error: `Dispute window expired. Allowed within ${DISPUTE_WINDOW_HOURS} hours after delivery.`,
      });
    }

    // Create dispute
    order.dispute = {
      status: "Open",
      reason: reason || "",
      notesCustomer: notesCustomer || "",
      notesAdmin: "",
      createdAt: new Date(),
      updatedAt: new Date(),
      refund: {
        amount: 0,
        currency: "QAR",
        method: "",
        refundId: "",
        refundedAt: null,
      },
    };

    await order.save();
    return res.json({ ok: true, dispute: order.dispute });
  } catch (e) {
    console.error("❌ customer dispute create:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// GET /api/customer/disputes/:orderId
router.get("/:orderId", requireCustomer, async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ ok: false, error: "Invalid order id" });
    }

    const order = await Order.findOne({
      _id: orderId,
      "customer.phone": req.customerPhone,
    }).lean();

    if (!order) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }

    return res.json({ ok: true, dispute: order.dispute || { status: "None" } });
  } catch (e) {
    console.error("❌ customer dispute get:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
