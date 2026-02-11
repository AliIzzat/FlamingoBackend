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
 * NOTE: Your current Order model uses:
 * - pickup.location.lat/lng (store pickup)
 * - customer.location.lat/lng (customer)
 *
 * If you still use restaurant GeoJSON elsewhere, keep it safe-checked.
 */
function attachCoordinateAliases(orders) {
  (orders || []).forEach((order) => {
    // If you still populate restaurant and it has GeoJSON coordinates: [lng, lat]
    const rCoords = order.restaurant?.coordinates?.coordinates;
    if (Array.isArray(rCoords) && rCoords.length === 2) {
      order.restaurantLng = rCoords[0];
      order.restaurantLat = rCoords[1];
    }

    // Customer location (lat/lng object)
    const cLoc = order.customer?.location;
    if (cLoc && typeof cLoc.lat === "number" && typeof cLoc.lng === "number") {
      order.customerLat = cLoc.lat;
      order.customerLng = cLoc.lng;
    }

    // Pickup/store location (lat/lng object) if needed in driver map
    const pLoc = order.pickup?.location;
    if (pLoc && typeof pLoc.lat === "number" && typeof pLoc.lng === "number") {
      order.pickupLat = pLoc.lat;
      order.pickupLng = pLoc.lng;
    }
  });
}

/* ============================================================
   WEB VIEWS (Driver)
   ============================================================ */

// ✅ View UNPICKED (unclaimed) orders
router.get("/available", requireLogin, requireRole(ROLE), async (req, res) => {
  try {
    const orders = await Order.find({
      "delivery.status": "Pending",
      "delivery.assignedDriverId": null, // ✅ critical for "unpicked"
    })
      .populate("pickup.storeId") // ✅ optional (shows store info if you want)
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

    const orders = await Order.find({ "delivery.assignedDriverId": userObjectId })
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

// ✅ Driver picks up an order (Claimed -> PickedUp)
router.post(
  "/pick-up/:id",
  requireLogin,
  requireRole("driver"),
  async (req, res) => {
    try {
      const orderId = req.params.id;
      const driverId = req.session.userId;

      const now = new Date();

      // Only allow driver to pick up an order assigned to him AND currently Claimed
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

      // ✅ Update notification
      await Notification.findOneAndUpdate(
        { orderId: order._id },
        { $set: { status: "picked", message: "Order picked up by driver" } },
        { new: true }
      );

      return res.redirect("/delivery/my-orders");
    } catch (err) {
      console.error("❌ Driver pick-up error:", err);
      return res.status(500).send("Server Error");
    }
  }
);


// ✅ Claim order (moves Pending -> Claimed)
router.post("/claim/:id", requireLogin, requireRole(ROLE), async (req, res) => {
  const orderId = req.params.id;
  const driverId = req.session.userId;

  try {
    // ✅ Only allow claim if still unpicked
    const order = await Order.findOne({
      _id: orderId,
      "delivery.status": "Pending",
      "delivery.assignedDriverId": null,
    });

    if (!order) return res.status(404).send("Order already claimed");

    order.delivery.status = "Claimed";
    order.delivery.assignedDriverId = driverId;
    order.delivery.claimedAt = new Date();
    await order.save();

    // ✅ Keep notifications aligned (if your Notification uses orderId)
    await Notification.findOneAndUpdate(
      { orderId: order._id },
      { status: "picked" } // if you prefer: "picked" = claimed (your current logic)
    );

    return res.redirect("/delivery/my-orders");
  } catch (err) {
    console.error("❌ Error claiming order:", err);
    return res.status(500).send("Server Error");
  }
});

/* 🔹 Get driver notifications (JSON) */
router.get(
  "/api/notifications",
  requireLogin,
  requireRole("driver"),
  async (req, res) => {
    try {
      const driverId = req.session.userId;

      const notifications = await Notification.find({ driverId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      return res.json({ success: true, notifications });
    } catch (err) {
      console.error("❌ Driver notifications API error:", err);
      return res.status(500).json({ success: false, message: "Server Error" });
    }
  }
);

// 🔹 Driver picks up an order (JSON)
router.post(
  "/api/pick-up/:id",
  requireLogin,
  requireRole("driver"),
  async (req, res) => {
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
      ).lean();

      if (!order) {
        return res.status(400).json({
          success: false,
          message: "Order not found or not allowed to pick up.",
        });
      }

      await Notification.findOneAndUpdate(
        { orderId: order._id },
        { $set: { status: "picked", message: "Order picked up by driver" } },
        { new: true }
      );

      return res.json({ success: true, order });
    } catch (err) {
      console.error("❌ Driver pick-up API error:", err);
      return res.status(500).json({ success: false, message: "Server Error" });
    }
  }
);


// ✅ Update status (Claimed -> PickedUp -> Delivered)
router.post(
  "/update-status/:id",
  requireLogin,
  requireRole(ROLE),
  async (req, res) => {
    const orderId = req.params.id;
    const { newStatus } = req.body; // expected: PickedUp or Delivered
    const userId = req.session.userId;

    try {
      const order = await Order.findOne({
        _id: orderId,
        "delivery.assignedDriverId": userId,
      });

      if (!order) return res.status(403).send("Unauthorized");

      // ✅ Strict transitions based on your schema enums
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

      // Notification sync (optional, aligned to your current mapping)
      const statusMap = {
        Claimed: "picked",
        PickedUp: "picked",
        Delivered: "delivered",
      };

      const newNotificationStatus = statusMap[newStatus];
      if (newNotificationStatus) {
        await Notification.findOneAndUpdate(
          { orderId: order._id },
          { status: newNotificationStatus }
        );
      }

      return res.redirect("/delivery/my-orders");
    } catch (err) {
      console.error("❌ Error updating status:", err);
      return res.status(500).send("Internal server error");
    }
  }
);

/* ============================================================
   JSON API (Driver App / Mobile)
   ============================================================ */

// 🔹 Get all available (UNPICKED) orders (JSON)
router.get("/api/available", requireLogin, requireRole(ROLE), async (req, res) => {
  try {
    const orders = await Order.find({
      "delivery.status": "Pending",
      "delivery.assignedDriverId": null,
    })
      .populate("pickup.storeId")
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
      "delivery.status": { $in: ["Claimed", "PickedUp"] },
    })
      .populate("pickup.storeId")
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
  const orderId = req.params.id;
  const driverId = req.session.userId;

  try {
    const order = await Order.findOne({
      _id: orderId,
      "delivery.status": "Pending",
      "delivery.assignedDriverId": null,
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

    await Notification.findOneAndUpdate(
      { orderId: order._id },
      { status: "picked" }
    );

    return res.json({ success: true, order });
  } catch (err) {
    console.error("❌ Error claiming order (API):", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
});

// 🔹 Update status (JSON)
router.post(
  "/api/update-status/:id",
  requireLogin,
  requireRole(ROLE),
  async (req, res) => {
    const orderId = req.params.id;
    const { newStatus } = req.body;
    const userId = req.session.userId;

    try {
      const order = await Order.findOne({
        _id: orderId,
        "delivery.assignedDriverId": userId,
      });

      if (!order) {
        return res
          .status(403)
          .json({ success: false, message: "Unauthorized or order not found" });
      }

      const validTransitions = {
        Pending: ["Claimed"],
        Claimed: ["PickedUp"],
        PickedUp: ["Delivered"],
      };

      const currentStatus = order.delivery.status;

      if (!validTransitions[currentStatus]?.includes(newStatus)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid status transition" });
      }

      order.delivery.status = newStatus;

      if (newStatus === "PickedUp") order.delivery.pickedUpAt = new Date();
      if (newStatus === "Delivered") order.delivery.deliveredAt = new Date();

      await order.save();

      const statusMap = {
        Claimed: "picked",
        PickedUp: "picked",
        Delivered: "delivered",
      };

      const newNotificationStatus = statusMap[newStatus];
      if (newNotificationStatus) {
        await Notification.findOneAndUpdate(
          { orderId: order._id },
          { status: newNotificationStatus }
        );
      }

      return res.json({ success: true, order });
    } catch (err) {
      console.error("❌ Error updating status (API):", err);
      return res.status(500).json({ success: false, message: "Server Error" });
    }
  }
);

module.exports = router;
