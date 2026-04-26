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
  router.get("/orders/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("pickup.storeId")
      .populate("delivery.assignedDriverId")
      .populate("items.productId")
      .populate("items.storeId");

    if (!order) {
      return res.status(404).send("Order not found");
    }

    res.render("backend/order-details", {
      title: "Order Details",
      order
    });
  } catch (err) {
    console.error("Error loading order details:", err);
    res.status(500).send("Server error");
  }
});

router.get(
  "/orders",
  requireLogin,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const filter = String(req.query.filter || "unpicked").trim();
      const q = String(req.query.q || "").trim();

      const query = buildFilter(filter);

      if (q) {
        query.$or = [
          { "customerSnapshot.name": { $regex: q, $options: "i" } },
          { "customerSnapshot.phone": { $regex: q, $options: "i" } },
          { "customerSnapshot.addressText": { $regex: q, $options: "i" } },
          { "pickup.addressText": { $regex: q, $options: "i" } },
          { "delivery.status": { $regex: q, $options: "i" } },
        ];

        if (mongoose.Types.ObjectId.isValid(q)) {
          query.$or.push({ _id: new mongoose.Types.ObjectId(q) });
        }
      }

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
        const d = o.delivery?.assignedDriverId;
        o.driverName = d ? d.name || d.username || String(d._id) : "—";

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
        q,

        activeFilter: filter,
        filters: ["unpicked", "Claimed", "PickedUp", "Delivered", "Cancelled"],
      });
    } catch (err) {
      console.error("❌ Admin orders error:", err);
      return res.status(500).send("Server Error");
    }
  }
);
router.get(
  "/reports/daily-revenue",
  requireLogin,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      const end = new Date();
      end.setHours(23, 59, 59, 999);

      const paidOrders = await Order.find({
        createdAt: { $gte: start, $lte: end },
        "payment.status": "paid",
      }).lean();

      const totalRevenue = paidOrders.reduce(
        (sum, order) => sum + Number(order.totals?.total || 0),
        0
      );

      const totalOrders = paidOrders.length;

      const averageOrderValue =
        totalOrders > 0 ? totalRevenue / totalOrders : 0;

      res.render("backend/daily-revenue", {
        title: "Daily Revenue",
        user: req.session.user || null,
        totalRevenue,
        totalOrders,
        averageOrderValue,
        paidOrders,
      });
    } catch (err) {
      console.error("Daily revenue error:", err);
      res.status(500).send("Server Error");
    }
  }
);

router.get(
  "/reports/delivery-analytics",
  requireLogin,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const orders = await Order.find({})
        .populate("delivery.assignedDriverId", "name username")
        .sort({ createdAt: -1 })
        .lean();

      const totalOrders = orders.length;
      const pending = orders.filter(o => o.delivery?.status === "Pending").length;
      const claimed = orders.filter(o => o.delivery?.status === "Claimed").length;
      const pickedUp = orders.filter(o => o.delivery?.status === "PickedUp").length;
      const delivered = orders.filter(o => o.delivery?.status === "Delivered").length;
      const cancelled = orders.filter(o => o.delivery?.status === "Cancelled").length;

      const deliveredOrders = orders.filter(
        o => o.delivery?.deliveredAt && o.delivery?.claimedAt
      );

      const avgDeliveryMinutes =
        deliveredOrders.length > 0
          ? deliveredOrders.reduce((sum, o) => {
              const start = new Date(o.delivery.claimedAt).getTime();
              const end = new Date(o.delivery.deliveredAt).getTime();
              return sum + Math.max(0, end - start) / 60000;
            }, 0) / deliveredOrders.length
          : 0;

      const driverMap = {};

      orders.forEach((o) => {
        const driver = o.delivery?.assignedDriverId;
        const driverKey = driver?._id ? String(driver._id) : "unassigned";
        const driverName = driver
          ? driver.name || driver.username || String(driver._id)
          : "Unassigned";

        if (!driverMap[driverKey]) {
          driverMap[driverKey] = {
            driverName,
            total: 0,
            delivered: 0,
            cancelled: 0,
            pending: 0,
          };
        }

        driverMap[driverKey].total += 1;

        if (o.delivery?.status === "Delivered") driverMap[driverKey].delivered += 1;
        if (o.delivery?.status === "Cancelled") driverMap[driverKey].cancelled += 1;
        if (o.delivery?.status === "Pending") driverMap[driverKey].pending += 1;
      });

      const driverStats = Object.values(driverMap);

      res.render("backend/delivery-analytics", {
        title: "Delivery Analytics",
        user: req.session.user || null,
        totalOrders,
        pending,
        claimed,
        pickedUp,
        delivered,
        cancelled,
        avgDeliveryMinutes: avgDeliveryMinutes.toFixed(1),
        driverStats,
      });
    } catch (err) {
      console.error("Delivery analytics error:", err);
      res.status(500).send("Server Error");
    }
  }
);

router.get(
  "/reports/failed-payments",
  requireLogin,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      const failedOrders = await Order.find({
        $or: [
          { "payment.status": "failed" },
          {
            "payment.status": "unpaid",
            createdAt: { $lte: thirtyMinutesAgo },
          },
        ],
      })
        .sort({ createdAt: -1 })
        .lean();

      res.render("backend/failed-payments", {
        title: "Failed Payment Alerts",
        user: req.session.user || null,
        failedOrders,
      });
    } catch (err) {
      console.error("Failed payments report error:", err);
      res.status(500).send("Server Error");
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