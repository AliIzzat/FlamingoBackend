const express = require("express");
const router = express.Router();   // ✅ MUST be here BEFORE router.get()

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const User = require("../../models/User");
const Order = require("../../models/Order");
const driverAuth = require("../../middleware/driverAuth");

// quick ping
router.get("/ping", (_req, res) => {
  res.json({ ok: true, service: "driver", time: new Date().toISOString() });
});

// GET available orders (Pending + unassigned)
router.get("/orders/available", driverAuth, async (req, res) => {
  try {
    const orders = await Order.find({
      "delivery.status": "Pending",
      "delivery.assignedDriverId": null,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ ok: true, orders });
  } catch (err) {
    console.error("❌ available orders:", err?.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST claim an order
router.post("/orders/:id/claim", driverAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "Invalid order id" });
    }

    const driverId = req.user?.id; // from JWT
    if (!driverId) {
      return res.status(401).json({ ok: false, error: "Invalid token payload" });
    }

    const updated = await Order.findOneAndUpdate(
      {
        _id: id,
        "delivery.status": "Pending",
        "delivery.assignedDriverId": null,
      },
      {
        $set: {
          "delivery.status": "Claimed",
          "delivery.assignedDriverId": driverId,
          "delivery.claimedAt": new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(409).json({ ok: false, error: "Order already claimed (or not pending)." });
    }

    return res.json({ ok: true, order: updated });
  } catch (err) {
    console.error("❌ claim:", err?.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// GET my orders (assigned to this driver)
router.get("/orders/my", driverAuth, async (req, res) => {
  try {
    const driverId = req.user?.id;
    const orders = await Order.find({
      "delivery.assignedDriverId": driverId,
      "delivery.status": { $in: ["Claimed", "PickedUp", "Delivered"] },
    })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    return res.json({ ok: true, orders });
  } catch (err) {
    console.error("❌ my orders:", err?.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST update status (Claimed->PickedUp->Delivered)
router.post("/orders/:id/status", driverAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!["PickedUp", "Delivered", "Cancelled"].includes(status)) {
      return res.status(400).json({ ok: false, error: "Invalid status" });
    }

    const driverId = req.user?.id;

    const order = await Order.findOne({ _id: id, "delivery.assignedDriverId": driverId });
    if (!order) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }

    // basic transition rules
    const current = order.delivery?.status;
    if (status === "PickedUp" && current !== "Claimed") {
      return res.status(409).json({ ok: false, error: "Order must be Claimed first" });
    }
    if (status === "Delivered" && current !== "PickedUp") {
      return res.status(409).json({ ok: false, error: "Order must be PickedUp first" });
    }

    order.delivery.status = status;
    if (status === "PickedUp") order.delivery.pickedUpAt = new Date();
    if (status === "Delivered") order.delivery.deliveredAt = new Date();

    await order.save();
    return res.json({ ok: true, order: order.toObject() });
  } catch (err) {
    console.error("❌ status:", err?.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});
module.exports = router;