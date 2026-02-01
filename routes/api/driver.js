const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Order = require("../../models/Order");

/**
 * Temporary auth (testing)
 * Header: x-driver-id: <User ObjectId>
 * Replace later with session/JWT middleware.
 */
function requireDriver(req, res, next) {
  const driverId = req.header("x-driver-id");
  if (!driverId) {
    return res.status(401).json({ ok: false, error: "Missing x-driver-id" });
  }
  if (!mongoose.Types.ObjectId.isValid(driverId)) {
    return res.status(400).json({ ok: false, error: "Invalid driver id" });
  }
  req.driverObjectId = new mongoose.Types.ObjectId(driverId);
  next();
}

const STATUS = {
  Pending: "Pending",
  Claimed: "Claimed",
  PickedUp: "PickedUp",
  Delivered: "Delivered",
  Cancelled: "Cancelled",
};

function attachCoords(order) {
  order.customerLat = order.customer?.location?.lat ?? null;
  order.customerLng = order.customer?.location?.lng ?? null;
  order.pickupLat = order.pickup?.location?.lat ?? null;
  order.pickupLng = order.pickup?.location?.lng ?? null;
  return order;
}

// ✅ GET /api/driver/orders/available
router.get("/orders/available", requireDriver, async (_req, res) => {
  try {
    const orders = await Order.find({
      "delivery.status": STATUS.Pending,
      "delivery.assignedDriverId": null,
    })
      .sort({ createdAt: -1 })
      .lean();

    orders.forEach(attachCoords);

    return res.json({ ok: true, orders });
  } catch (e) {
    console.error("❌ driver available:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ✅ POST /api/driver/orders/:id/claim (atomic)
router.post("/orders/:id/claim", requireDriver, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "Invalid order id" });
    }

    const updated = await Order.findOneAndUpdate(
      {
        _id: id,
        "delivery.status": STATUS.Pending,
        "delivery.assignedDriverId": null,
      },
      {
        $set: {
          "delivery.status": STATUS.Claimed,
          "delivery.assignedDriverId": req.driverObjectId,
          "delivery.claimedAt": new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(409).json({
        ok: false,
        error: "Order already claimed (or not pending).",
      });
    }

    return res.json({ ok: true, order: attachCoords(updated) });
  } catch (e) {
    console.error("❌ driver claim:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ✅ GET /api/driver/orders/my
router.get("/orders/my", requireDriver, async (req, res) => {
  try {
    const orders = await Order.find({
      "delivery.assignedDriverId": req.driverObjectId,
      "delivery.status": { $in: [STATUS.Claimed, STATUS.PickedUp, STATUS.Delivered] },
    })
      .sort({ createdAt: -1 })
      .lean();

    orders.forEach(attachCoords);

    return res.json({ ok: true, orders });
  } catch (e) {
    console.error("❌ driver my:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ✅ POST /api/driver/orders/:id/status
router.post("/orders/:id/status", requireDriver, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "Invalid order id" });
    }

    const allowed = [STATUS.PickedUp, STATUS.Delivered];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: "Invalid status" });
    }

    const mustCurrentlyBe = status === STATUS.PickedUp ? STATUS.Claimed : STATUS.PickedUp;

    const patch = { "delivery.status": status };
    if (status === STATUS.PickedUp) patch["delivery.pickedUpAt"] = new Date();
    if (status === STATUS.Delivered) patch["delivery.deliveredAt"] = new Date();

    const updated = await Order.findOneAndUpdate(
      {
        _id: id,
        "delivery.assignedDriverId": req.driverObjectId,
        "delivery.status": mustCurrentlyBe,
      },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(409).json({
        ok: false,
        error: "Order not found for this driver, or invalid transition.",
      });
    }

    return res.json({ ok: true, order: attachCoords(updated) });
  } catch (e) {
    console.error("❌ driver status:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
