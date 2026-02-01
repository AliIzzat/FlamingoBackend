// routes/backend/adminOrders.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Order = require("../../models/Order");
const User = require("../../models/User");
const Notification = require("../../models/Notification");

const { requireLogin, requireRole } = require("../../middleware/auth");

const ADMIN_ROLES = ["admin", "support"]; // add "data_entry" if you want

function buildFilter(filterKey) {
  const key = String(filterKey || "unpicked").trim();

  switch (key) {
    case "unpicked":
      return {
        "delivery.status": "Pending",
        "delivery.assignedDriverId": null,
      };


    case "Claimed":
      return {
        "delivery.status": "Claimed",
        "delivery.assignedDriverId": { $ne: null },
      };

    case "PickedUp":
      return { "delivery.status": "PickedUp" };

    case "Delivered":
      return { "delivery.status": "Delivered" };

    case "Cancelled":
      return { "delivery.status": "Cancelled" };

    default:
      return {
        "delivery.status": "Pending",
        "delivery.assignedDriverId": null,
      };
  }
}

/* ============================================================
   GET /admin/orders?filter=unpicked
   ============================================================ */
router.get(
  "/orders",
  requireLogin,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const filter = String(req.query.filter || "unpicked").trim();
      const query = buildFilter(filter);

      // Drivers list (for dropdown)
      const drivers = await User.find({ role: "driver" })
        .select("name username role")
        .sort({ name: 1, username: 1 })
        .lean();

      const orders = await Order.find(query)
        .populate("pickup.storeId")
        .populate("delivery.assignedDriverId", "name username role")
        .sort({ createdAt: -1 })
        .lean();
       const now = Date.now();

          orders.forEach((o) => {
            // Driver display name
            const d = o.delivery?.assignedDriverId;
            o.driverName = d ? (d.name || d.username || String(d._id)) : "—";

            // Age (time since created)
            const created = o.createdAt ? new Date(o.createdAt).getTime() : now;
            const diffMs = Math.max(0, now - created);

            const mins = Math.floor(diffMs / 60000);
            const hrs = Math.floor(mins / 60);
            const days = Math.floor(hrs / 24);

            if (days > 0) o.createdSince = `${days}d ${hrs % 24}h`;
            else if (hrs > 0) o.createdSince = `${hrs}h ${mins % 60}m`;
            else o.createdSince = `${mins}m`;
          });


      return res.render("backend/admin-orders-unpicked", {
        title: "Orders",
        user: req.session.user || null,

        orders,
        drivers,

        activeFilter: filter,
        filters: ["unpicked", "Claimed", "PickedUp", "Delivered", "Cancelled"],
      });
    } catch (err) {
      console.error("❌ Admin orders error:", err);
      return res.status(500).send("Server Error");
    }
  }
);

/* ============================================================
   POST /admin/orders/:id/assign-driver
   - sets delivery.status = Claimed
   - sets assignedDriverId
   - updates Notification => claimed
   ============================================================ */
router.post(
  "/orders/:id/assign-driver",
  requireLogin,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const orderId = req.params.id;
      const { driverId, returnFilter } = req.body;

      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).send("Invalid order id");
      }
      if (!mongoose.Types.ObjectId.isValid(driverId)) {
        return res.status(400).send("Invalid driver id");
      }

      const now = new Date();

      await Order.findByIdAndUpdate(orderId, {
        $set: {
          "delivery.status": "Claimed",
          "delivery.assignedDriverId": driverId,
          "delivery.claimedAt": now,
        },
      });

      // Notification: claimed
      const oid = new mongoose.Types.ObjectId(orderId);
      await Notification.findOneAndUpdate(
      { orderId: oid },
        {
          $setOnInsert: { orderId, createdAt: now },
          $set: {
            status: "claimed",
            driverId,
            updatedAt: now,
            message: "Order assigned to driver",
          },
        },
        { upsert: true, new: true }
      );

      return res.redirect(
        `/admin/orders?filter=${encodeURIComponent(returnFilter || "unpicked")}`
      );
    } catch (err) {
      console.error("❌ Assign driver error:", err);
      return res.status(500).send("Server Error");
    }
  }
);

/* ============================================================
   POST /admin/orders/:id/cancel
   - sets delivery.status = Cancelled
   - clears driver
   - updates Notification => cancelled
   ============================================================ */
router.post(
  "/orders/:id/cancel",
  requireLogin,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { returnFilter } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).send("Invalid order id");
      }

      const now = new Date();

      await Order.findByIdAndUpdate(id, {
        $set: {
          "delivery.status": "Cancelled",
          "delivery.assignedDriverId": null,
          "delivery.claimedAt": null,
          "delivery.pickedUpAt": null,
          "delivery.deliveredAt": null,
        },
      });

      await Notification.findOneAndUpdate(
        { orderId: id },
        {
          $setOnInsert: { orderId: id, createdAt: now },
          $set: {
            status: "cancelled",
            driverId: null,
            updatedAt: now,
            message: "Order cancelled by admin",
          },
        },
        { upsert: true, new: true }
      );

      return res.redirect(
        `/admin/orders?filter=${encodeURIComponent(returnFilter || "unpicked")}`
      );
    } catch (err) {
      console.error("❌ Cancel order error:", err);
      return res.status(500).send("Server Error");
    }
  }
);

module.exports = router;