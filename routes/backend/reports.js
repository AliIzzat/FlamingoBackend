const express = require("express");
const router = express.Router();
const User = require("../../models/User");

const Order = require("../../models/Order");
// GET /backend/reports/driver-meals
router.get("/driver-meals", async (req, res) => {
  const driversList = await User.find({ role: "driver" })
  .select("_id username")
  .sort({ username: 1 })
  .lean();

  try {
    const { from, to, driverId, mode } = req.query;

    const dateField = mode === "delivered"
      ? "delivery.deliveredAt"
      : "createdAt";

    const filter = {
      "delivery.assignedDriverId": { $ne: null },
    };

    if (driverId) {
      filter["delivery.assignedDriverId"] = driverId;
    }

    if (from || to) {
      filter[dateField] = {};
      if (from) filter[dateField].$gte = new Date(from + "T00:00:00.000Z");
      if (to) filter[dateField].$lte = new Date(to + "T23:59:59.999Z");
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate("delivery.assignedDriverId", "username")
      .lean();

    const map = {};

    for (const order of orders) {
      const drv = order.delivery?.assignedDriverId;
      if (!drv) continue;

      const dId = String(drv._id);
      if (!map[dId]) {
        map[dId] = {
          driverId: dId,
          driverName: drv.username || "Unknown",
          orders: [],
        };
      }

      const items = Array.isArray(order.items) ? order.items : [];

      for (const it of items) {
        const price = Number(it.price_snapshot || 0);
        const qty = Number(it.qty || 0);

        map[dId].orders.push({
          orderId: order._id,
          status: order.delivery?.status || "",
          createdAt: order.createdAt
            ? new Date(order.createdAt).toLocaleString("en-GB")
            : "",
          deliveredAt: order.delivery?.deliveredAt
            ? new Date(order.delivery.deliveredAt).toLocaleString("en-GB")
            : "",
          customerName: order.customer?.name || "",
          customerMobile: order.customer?.phone || "",
          mealName: it.name_snapshot || "",
          quantity: qty,
          price,
          lineTotal: price * qty,
          totalAmount: Number(order.totals?.total || 0),
        });
      }
    }

    const drivers = Object.values(map);

    let grandLineTotal = 0;
    let grandOrderTotal = 0;

    drivers.forEach((d) => {
      let lt = 0;
      let ot = 0;
      d.orders.forEach((r) => {
        lt += r.lineTotal || 0;
        ot += r.totalAmount || 0;
      });
      d.driverLineTotal = lt;
      d.driverOrderTotal = ot;
      grandLineTotal += lt;
      grandOrderTotal += ot;
    });

    res.render("backend/driver-meals-report", {
      layout: "driver",
      title: "Meals per Driver",
      drivers,
      grandLineTotal,
      grandOrderTotal,
      filters: { from: from || "", to: to || "", driverId: driverId || "", mode: mode || "created" },
      driversList,
    });
  } catch (err) {
    console.error("❌ driver-meals report:", err);
    res.status(500).send("Server error generating driver report");
  }
});

module.exports = router;
