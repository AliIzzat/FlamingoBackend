const express = require("express");
const router = express.Router();
const Notification = require("../../models/Notification");
const Category = require("../../models/Category");
const Order = require("../../models/Order");
const { printOrderToStore } = require("../../services/storePrinter");

router.get("/", (req, res) => res.redirect("/admin/dashboard"));

router.get("/dashboard", async (req, res) => {
  try {
    const [notifications, categories] = await Promise.all([
      Notification.find().sort({ createdAt: -1 }).limit(50).lean(),
      Category.find({ isActive: true }).sort({ sortOrder: 1, name_en: 1 }).lean(),
    ]);

    res.render("backend/dashboard", {
      layout: "backend-layout",
      title: "Admin Dashboard",
      user: req.session.user,
      notifications,
      categories,
    });
  } catch (e) {
    console.error("❌ admin dashboard:", e);
    res.status(500).send("Failed to load dashboard");
  }
});

router.get("/test-print-check", (req, res) => {
  res.send("test print route is working");
});

router.get("/test-print/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).send("Order not found.");
    }

    const result = await printOrderToStore(order);

    return res.send(`
      <h2>Test print sent successfully</h2>
      <p>Order ID: ${order._id}</p>
      <pre>${JSON.stringify(result, null, 2)}</pre>
    `);
  } catch (err) {
    console.error("TEST PRINT ERROR:", err);
    return res.status(500).send(`
      <h2>Test print failed</h2>
      <pre>${err.message}</pre>
    `);
  }
});

module.exports = router;