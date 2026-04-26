const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../../models/User");
const Order = require("../../models/Order");

// GET /backend/reports/driver-meals
router.get("/driver-meals", async (req, res) => {
  try {
    const driversList = await User.find({ role: "driver" })
      .select("_id name")
      .sort({ name: 1 })
      .lean();

    const { from, to, driverId, mode } = req.query;

    const dateField =
      mode === "delivered" ? "delivery.deliveredAt" : "createdAt";

    const query = {
      "delivery.assignedDriverId": { $ne: null },
      "payment.status": "paid",
    };

    if (driverId && mongoose.Types.ObjectId.isValid(driverId)) {
      query["delivery.assignedDriverId"] = new mongoose.Types.ObjectId(driverId);
    }

    if (from || to) {
      query[dateField] = {};
      if (from) query[dateField].$gte = new Date(from + "T00:00:00.000Z");
      if (to) query[dateField].$lte = new Date(to + "T23:59:59.999Z");
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .populate({
        path: "delivery.assignedDriverId",
        select: "name",
      })
      .lean();

    const map = {};

    for (const order of orders) {
      const drv = order.delivery?.assignedDriverId;
      if (!drv) continue;

      const dId = String(drv._id);
      const driverName = drv.name?.trim() || "Unknown Driver";

      if (!map[dId]) {
        map[dId] = {
          driverId: dId,
          driverName,
          orders: [],
        };
      }

      const items = Array.isArray(order.items) ? order.items : [];

      for (const item of items) {
        const quantity = Number(item.qty || 0);
        const price = Number(item.price_snapshot || 0);
        const lineTotal = quantity * price;

        map[dId].orders.push({
          orderId: String(order._id || ""),
          status: order.delivery?.status || "",
          createdAt: order.createdAt
            ? new Date(order.createdAt).toLocaleString("en-GB")
            : "",
          driverName,
          customerName: order.customerSnapshot?.name || "",
          customerMobile: order.customerSnapshot?.phone || "",
          customerAddress: order.customerSnapshot?.addressText || "",
          mealName: item.name_snapshot || "",
          quantity,
          price,
          lineTotal,
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

    const filters = {
      from: from || "",
      to: to || "",
      mode: mode || "created",
      driverId: driverId || "",
    };

    return res.render("backend/driver-meals-report", {
      layout: "backend-layout",
      title: "Driver Report",
      user: req.session.user || null,
      drivers,
      driversList,
      filters,
      grandLineTotal,
      grandOrderTotal,
    });
  } catch (err) {
    console.error("❌ driver-meals report:", err);
    return res.status(500).send(err.message);
  }
});

module.exports = router;