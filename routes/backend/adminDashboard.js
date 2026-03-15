const express = require("express");
const router = express.Router();

const Notification = require("../../models/Notification");
const Order = require("../../models/Order");

// Redirect /admin -> /admin/dashboard
router.get("/", (req, res) => res.redirect("/admin/dashboard"));

// Main dashboard page
router.get("/dashboard", async (req, res) => {
  try {
    const [
      notifications,
      pendingOrders,
      pickedOrders,
      deliveredOrders,
      totalOrders,
      latestOrders,
    ] = await Promise.all([
      Notification.find({})
        .sort({ createdAt: -1 })
        .populate("orderId")
        .populate("driverId", "username name")
        .lean(),

      Order.countDocuments({ status: "Pending" }),
      Order.countDocuments({ status: "PickedUp" }),
      Order.countDocuments({ status: "Delivered" }),
      Order.countDocuments(),

      Order.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("items.storeId")
        .lean(),
    ]);

    return res.render("backend/dashboard", {
      layout: "backend-layout",
      title: "Dashboard",
      notifications,
      pendingOrders,
      pickedOrders,
      deliveredOrders,
      totalOrders,
      latestOrders,
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("❌ dashboard error:", err);
    return res.status(500).send("Failed to load dashboard");
  }
});

// Live dashboard data for AJAX polling
router.get("/dashboard/live", async (req, res) => {
  try {
    const [pendingOrders, pickedOrders, deliveredOrders, totalOrders, latestOrders] =
      await Promise.all([
        Order.countDocuments({ status: "Pending" }),
        Order.countDocuments({ status: "PickedUp" }),
        Order.countDocuments({ status: "Delivered" }),
        Order.countDocuments(),

        Order.find()
          .sort({ createdAt: -1 })
          .limit(10)
          .populate("items.storeId")
          .lean(),
      ]);

    res.json({
      success: true,
      stats: {
        pendingOrders,
        pickedOrders,
        deliveredOrders,
        totalOrders,
      },
      latestOrders,
    });
  } catch (error) {
    console.error("Dashboard live update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load dashboard updates",
    });
  }
});

module.exports = router;