// routes/backend/delivery.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Order = require("../../models/Order");
const Notification = require("../../models/Notification");

// 🔒 Auth helpers
const { requireLogin, requireRole } = require("../../middleware/auth");

/**
 * Roles: driver, support, data_entry, admin
 */
const ROLE = "driver";

/**
 * Helper: attach coordinate aliases to orders
 */
function attachCoordinateAliases(orders) {
  (orders || []).forEach((order) => {
    // Customer location
    const cLoc = order.customer?.location;
    if (cLoc && typeof cLoc.lat === "number" && typeof cLoc.lng === "number") {
      order.customerLat = cLoc.lat;
      order.customerLng = cLoc.lng;
    }

    // Pickup/store location
    const pLoc = order.pickup?.location;
    if (pLoc && typeof pLoc.lat === "number" && typeof pLoc.lng === "number") {
      order.pickupLat = pLoc.lat;
      order.pickupLng = pLoc.lng;
    }
  });
}

/**
 * Helper: sync notification with real order state
 */
async function syncNotification(order, driverId = null) {
  if (!order) return;

  let notificationStatus = null;

  if (order.delivery?.status === "Pending") {
    notificationStatus = "unpicked";
  } else if (
    order.delivery?.status === "Claimed" ||
    order.delivery?.status === "PickedUp"
  ) {
    notificationStatus = "picked";
  } else if (order.delivery?.status === "Delivered") {
    notificationStatus = "delivered";
  }

  if (!notificationStatus) return;

  await Notification.findOneAndUpdate(
    { orderId: order._id },
    {
      $set: {
        status: notificationStatus,
        driverId: driverId || order.delivery?.assignedDriverId || null,
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
}

/* ============================================================
   WEB VIEWS (Driver)
   ============================================================ */

// ✅ View available (unclaimed) orders
router.get("/available", requireLogin, requireRole(ROLE), async (req, res) => {
  try {
    const orders = await Order.find({
      "delivery.status": "Pending",
      "delivery.assignedDriverId": null,
      "payment.status": "paid", // ✅ only real paid orders
    })
      .populate("pickup.storeId")
      .sort({ createdAt: -1 })
      .lean();

    attachCoordinateAliases(orders);

    return res.render("backend/delivery-available", {
      layout: "driver-layout",
      title: "Available Orders (Unpicked)",
      user: req.session.user || null,
      orders,
    });
  } catch (err) {
    console.error("❌ Error loading available orders:", err);
    return res.status(500).send("Server Error");
  }
});

// ✅ View orders assigned to this driver
router.get("/my-orders", requireLogin, requireRole(ROLE), async (req, res) => {
  try {
    const userId = req.session.userId;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const orders = await Order.find({
      "delivery.assignedDriverId": userObjectId,
      "payment.status": "paid",
    })
      .populate("delivery.assignedDriverId", "name username role")
      .populate("pickup.storeId")
      .sort({ createdAt: -1 })
      .lean();

    attachCoordinateAliases(orders);

    return res.render("backend/delivery-my-orders", {
      layout: "driver-layout",
      title: "My Orders",
      user: req.session.user || null,
      orders,
    });
  } catch (err) {
    console.error("❌ Error loading driver orders:", err);
    return res.status(500).send("Server Error");
  }
});

// ✅ Claim order (Pending -> Claimed)
router.post("/claim/:id", requireLogin, requireRole(ROLE), async (req, res) => {
  try {
    const orderId = req.params.id;
    const driverId = req.session.userId;
    const now = new Date();

    const order = await Order.findOneAndUpdate(
      {
        _id: orderId,
        "delivery.status": "Pending",
        "delivery.assignedDriverId": null,
        "payment.status": "paid",
      },
      {
        $set: {
          "delivery.status": "Claimed",
          "delivery.assignedDriverId": driverId,
          "delivery.claimedAt": now,
        },
      },
      { new: true }
    );

    if (!order) {
      return res.status(400).send("Order not found or already claimed.");
    }

    await syncNotification(order, driverId);

    return res.redirect("/delivery/my-orders");
  } catch (err) {
    console.error("❌ Driver claim error:", err);
    return res.status(500).send("Server Error");
  }
});

// ✅ Driver picks up an order (Claimed -> PickedUp)
router.post("/pick-up/:id", requireLogin, requireRole(ROLE), async (req, res) => {
  try {
    const orderId = req.params.id;
    const driverId = req.session.userId;
    const now = new Date();

    const order = await Order.findOneAndUpdate(
      {
        _id: orderId,
        "delivery.assignedDriverId": driverId,
        "delivery.status": "Claimed",
      },
      {
        $set: {
          "delivery.status": "PickedUp",
          "delivery.pickedUpAt": now,
        },
      },
      { new: true }
    );

    if (!order) {
      return res.status(400).send("Order not found or not allowed to pick up.");
    }

    await syncNotification(order, driverId);

    return res.redirect("/delivery/my-orders");
  } catch (err) {
    console.error("❌ Driver pick-up error:", err);
    return res.status(500).send("Server Error");
  }
});

// ✅ Update status (Claimed -> PickedUp -> Delivered)
router.post("/update-status/:id", requireLogin, requireRole(ROLE), async (req, res) => {
  const orderId = req.params.id;
  const { newStatus } = req.body;
  const userId = req.session.userId;

  try {
    const order = await Order.findOne({
      _id: orderId,
      "delivery.assignedDriverId": userId,
    });

    if (!order) {
      return res.status(403).send("Unauthorized");
    }

    const validTransitions = {
      Pending: ["Claimed"],
      Claimed: ["PickedUp"],
      PickedUp: ["Delivered"],
    };

    const currentStatus = order.delivery.status;

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      return res.status(400).send("Invalid status transition");
    }

    order.delivery.status = newStatus;

    if (newStatus === "PickedUp") order.delivery.pickedUpAt = new Date();
    if (newStatus === "Delivered") order.delivery.deliveredAt = new Date();

    await order.save();

    await syncNotification(order, userId);

    return res.redirect("/delivery/my-orders");
  } catch (err) {
    console.error("❌ Error updating status:", err);
    return res.status(500).send("Internal server error");
  }
});

/* ============================================================
   JSON API (Driver App / Mobile)
   ============================================================ */

// 🔹 Get driver notifications (JSON)
router.get("/api/notifications", requireLogin, requireRole(ROLE), async (req, res) => {
  try {
    const driverId = req.session.userId;

    const notifications = await Notification.find({
      $or: [{ driverId }, { driverId: null }],
      status: { $in: ["unpicked", "picked", "delivered"] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ success: true, notifications });
  } catch (err) {
    console.error("❌ Driver notifications API error:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
});

// 🔹 Get all available (unpicked) orders (JSON)
router.get("/api/available", requireLogin, requireRole(ROLE), async (req, res) => {
  try {
    const orders = await Order.find({
      "delivery.status": "Pending",
      "delivery.assignedDriverId": null,
      "payment.status": "paid",
    })
      .populate("pickup.storeId")
      .sort({ createdAt: -1 })
      .lean();

    attachCoordinateAliases(orders);

    return res.json({ success: true, orders });
  } catch (err) {
    console.error("❌ Error loading available orders (API):", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
});

// 🔹 Get orders assigned to this driver (JSON)
router.get("/api/my-orders", requireLogin, requireRole(ROLE), async (req, res) => {
  try {
    const userId = req.session.userId;

    const orders = await Order.find({
      "delivery.assignedDriverId": userId,
      "delivery.status": { $in: ["Claimed", "PickedUp", "Delivered"] },
      "payment.status": "paid",
    })
      .populate("pickup.storeId")
      .sort({ createdAt: -1 })
      .lean();

    attachCoordinateAliases(orders);

    return res.json({ success: true, orders });
  } catch (err) {
    console.error("❌ Error loading driver orders (API):", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
});

// 🔹 Claim order (JSON)
router.post("/api/claim/:id", requireLogin, requireRole(ROLE), async (req, res) => {
  try {
    const orderId = req.params.id;
    const driverId = req.session.userId;

    const order = await Order.findOne({
      _id: orderId,
      "delivery.status": "Pending",
      "delivery.assignedDriverId": null,
      "payment.status": "paid",
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order already claimed or not found",
      });
    }

    order.delivery.status = "Claimed";
    order.delivery.assignedDriverId = driverId;
    order.delivery.claimedAt = new Date();

    await order.save();
    await syncNotification(order, driverId);

    return res.json({ success: true, order });
  } catch (err) {
    console.error("❌ Error claiming order (API):", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
});

// 🔹 Driver picks up an order (JSON)
router.post("/api/pick-up/:id", requireLogin, requireRole(ROLE), async (req, res) => {
  try {
    const orderId = req.params.id;
    const driverId = req.session.userId;

    const order = await Order.findOne({
      _id: orderId,
      "delivery.assignedDriverId": driverId,
      "delivery.status": "Claimed",
    });

    if (!order) {
      return res.status(400).json({
        success: false,
        message: "Order not found or not allowed to pick up.",
      });
    }

    order.delivery.status = "PickedUp";
    order.delivery.pickedUpAt = new Date();

    await order.save();
    await syncNotification(order, driverId);

    return res.json({ success: true, order });
  } catch (err) {
    console.error("❌ Driver pick-up API error:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
});

// 🔹 Update status (JSON)
router.post("/api/update-status/:id", requireLogin, requireRole(ROLE), async (req, res) => {
  const orderId = req.params.id;
  const { newStatus } = req.body;
  const userId = req.session.userId;

  try {
    const order = await Order.findOne({
      _id: orderId,
      "delivery.assignedDriverId": userId,
    });

    if (!order) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized or order not found",
      });
    }

    const validTransitions = {
      Pending: ["Claimed"],
      Claimed: ["PickedUp"],
      PickedUp: ["Delivered"],
    };

    const currentStatus = order.delivery.status;

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status transition",
      });
    }

    order.delivery.status = newStatus;

    if (newStatus === "PickedUp") order.delivery.pickedUpAt = new Date();
    if (newStatus === "Delivered") order.delivery.deliveredAt = new Date();

    await order.save();
    await syncNotification(order, userId);

    return res.json({ success: true, order });
  } catch (err) {
    console.error("❌ Error updating status (API):", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
});

module.exports = router;