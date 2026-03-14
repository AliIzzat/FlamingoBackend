const express = require("express");
const router = express.Router();

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const User = require("../../models/User");
const Order = require("../../models/Order");
const Notification = require("../../models/Notification");
const driverAuth = require("../../middleware/driverAuth");

// -------------------------
// Notification sync helper
// -------------------------
async function syncNotification(order, driverId = null) {
  if (!order?._id) {
    console.log("🔔 syncNotification skipped: missing order._id");
    return;
  }

  let notifStatus = "unpicked";

  switch (order.delivery?.status) {
    case "Claimed":
      notifStatus = "claimed";
      break;
    case "PickedUp":
      notifStatus = "picked";
      break;
    case "Delivered":
      notifStatus = "delivered";
      break;
    case "Cancelled":
      notifStatus = "cancelled";
      break;
    case "Pending":
    default:
      notifStatus = "unpicked";
      break;
  }

  const finalDriverId = driverId || order.delivery?.assignedDriverId || null;

  const result = await Notification.findOneAndUpdate(
    { orderId: order._id },
    {
      $set: {
        status: notifStatus,
        driverId: finalDriverId,
        updatedAt: new Date(),
        message:
          notifStatus === "claimed"
            ? "🚚 Order claimed by driver"
            : notifStatus === "picked"
            ? "📦 Order picked up"
            : notifStatus === "delivered"
            ? "✅ Order delivered"
            : notifStatus === "cancelled"
            ? "❌ Order cancelled"
            : "🆕 New order awaiting driver",
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    {
      new: true,
      upsert: true,
    }
  );

  console.log("🔔 syncNotification result:", {
    orderId: String(order._id),
    orderStatus: order.delivery?.status,
    notifStatus,
    driverId: finalDriverId ? String(finalDriverId) : null,
    notificationId: result?._id ? String(result._id) : null,
  });
}

// quick ping
router.get("/ping", (_req, res) => {
  res.json({ ok: true, service: "driver", time: new Date().toISOString() });
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "username and password are required" });
    }

    const user = await User.findOne({
      username: String(username).trim(),
      role: "driver",
    }).lean();

    if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const stored = user.password || "";
    const isHashed = stored.startsWith("$2");
    const match = isHashed ? await bcrypt.compare(password, stored) : String(password) === stored;

    if (!match) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const secret = process.env.JWT_SECRET || process.env.DRIVER_JWT_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: "JWT secret missing on server" });

    const token = jwt.sign({ id: String(user._id), role: "driver" }, secret, { expiresIn: "30d" });

    return res.json({
      ok: true,
      token,
      driver: {
        id: String(user._id),
        name: user.name || user.username,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("💥 DRIVER LOGIN CRASH:", err);
    return res.status(500).json({ ok: false, error: "Server error", debug: err?.message });
  }
});

// GET available orders
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

    const driverId = req.user?.id;
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
    );

    if (!updated) {
      return res.status(409).json({ ok: false, error: "Order already claimed (or not pending)." });
    }

    // ✅ sync notification
    await syncNotification(updated, driverId);

    return res.json({ ok: true, order: updated.toObject() });
  } catch (err) {
    console.error("❌ claim:", err?.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// GET my orders
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

// POST update status
router.post("/orders/:id/status", driverAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!["PickedUp", "Delivered", "Cancelled"].includes(status)) {
      return res.status(400).json({ ok: false, error: "Invalid status" });
    }

    const driverId = req.user?.id;

    const order = await Order.findOne({
      _id: id,
      "delivery.assignedDriverId": driverId,
    });

    if (!order) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }

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

    // ✅ sync notification
    await syncNotification(order, driverId);

    return res.json({ ok: true, order: order.toObject() });
  } catch (err) {
    console.error("❌ status:", err?.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;




// const express = require("express");
// const router = express.Router();   // ✅ MUST be here BEFORE router.get()

// const jwt = require("jsonwebtoken");
// const bcrypt = require("bcryptjs");
// const mongoose = require("mongoose");

// const User = require("../../models/User");
// const Order = require("../../models/Order");
// const driverAuth = require("../../middleware/driverAuth");

// // quick ping
// router.get("/ping", (_req, res) => {
//   res.json({ ok: true, service: "driver", time: new Date().toISOString() });
// });

// router.post("/login", async (req, res) => {
//   try {
//     const { username, password } = req.body || {};

//     if (!username || !password) {
//       return res.status(400).json({ ok: false, error: "username and password are required" });
//     }

//     const user = await User.findOne({
//       username: String(username).trim(),
//       role: "driver",
//     }).lean();

//     if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });

//     const stored = user.password || "";
//     const isHashed = stored.startsWith("$2");
//     const match = isHashed ? await bcrypt.compare(password, stored) : String(password) === stored;

//     if (!match) return res.status(401).json({ ok: false, error: "Invalid credentials" });

//     const secret = process.env.JWT_SECRET || process.env.DRIVER_JWT_SECRET;
//     if (!secret) return res.status(500).json({ ok: false, error: "JWT secret missing on server" });

//     const token = jwt.sign({ id: String(user._id), role: "driver" }, secret, { expiresIn: "30d" });

//     return res.json({
//       ok: true,
//       token,
//       driver: { id: String(user._id), name: user.name || user.username, username: user.username, role: user.role },
//     });
//   } catch (err) {
//     console.error("💥 DRIVER LOGIN CRASH:", err);
//     return res.status(500).json({ ok: false, error: "Server error", debug: err?.message });
//   }
// });

// // GET available orders (Pending + unassigned)
// router.get("/orders/available", driverAuth, async (req, res) => {
//   try {
//     const orders = await Order.find({
//       "delivery.status": "Pending",
//       "delivery.assignedDriverId": null,
//     })
//       .sort({ createdAt: -1 })
//       .limit(50)
//       .lean();

//     return res.json({ ok: true, orders });
//   } catch (err) {
//     console.error("❌ available orders:", err?.message);
//     return res.status(500).json({ ok: false, error: "Server error" });
//   }
// });

// // POST claim an order
// router.post("/orders/:id/claim", driverAuth, async (req, res) => {
//   try {
//     const { id } = req.params;
//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({ ok: false, error: "Invalid order id" });
//     }

//     const driverId = req.user?.id; // from JWT
//     if (!driverId) {
//       return res.status(401).json({ ok: false, error: "Invalid token payload" });
//     }

//     const updated = await Order.findOneAndUpdate(
//       {
//         _id: id,
//         "delivery.status": "Pending",
//         "delivery.assignedDriverId": null,
//       },
//       {
//         $set: {
//           "delivery.status": "Claimed",
//           "delivery.assignedDriverId": driverId,
//           "delivery.claimedAt": new Date(),
//         },
//       },
//       { new: true }
//     ).lean();

//     if (!updated) {
//       return res.status(409).json({ ok: false, error: "Order already claimed (or not pending)." });
//     }

//     return res.json({ ok: true, order: updated });
//   } catch (err) {
//     console.error("❌ claim:", err?.message);
//     return res.status(500).json({ ok: false, error: "Server error" });
//   }
// });

// // GET my orders (assigned to this driver)
// router.get("/orders/my", driverAuth, async (req, res) => {
//   try {
//     const driverId = req.user?.id;
//     const orders = await Order.find({
//       "delivery.assignedDriverId": driverId,
//       "delivery.status": { $in: ["Claimed", "PickedUp", "Delivered"] },
//     })
//       .sort({ updatedAt: -1 })
//       .limit(50)
//       .lean();

//     return res.json({ ok: true, orders });
//   } catch (err) {
//     console.error("❌ my orders:", err?.message);
//     return res.status(500).json({ ok: false, error: "Server error" });
//   }
// });

// // POST update status (Claimed->PickedUp->Delivered)
// router.post("/orders/:id/status", driverAuth, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body || {};
//     if (!["PickedUp", "Delivered", "Cancelled"].includes(status)) {
//       return res.status(400).json({ ok: false, error: "Invalid status" });
//     }

//     const driverId = req.user?.id;

//     const order = await Order.findOne({ _id: id, "delivery.assignedDriverId": driverId });
//     if (!order) {
//       return res.status(404).json({ ok: false, error: "Order not found" });
//     }

//     // basic transition rules
//     const current = order.delivery?.status;
//     if (status === "PickedUp" && current !== "Claimed") {
//       return res.status(409).json({ ok: false, error: "Order must be Claimed first" });
//     }
//     if (status === "Delivered" && current !== "PickedUp") {
//       return res.status(409).json({ ok: false, error: "Order must be PickedUp first" });
//     }

//     order.delivery.status = status;
//     if (status === "PickedUp") order.delivery.pickedUpAt = new Date();
//     if (status === "Delivered") order.delivery.deliveredAt = new Date();

//     await order.save();
//     return res.json({ ok: true, order: order.toObject() });
//   } catch (err) {
//     console.error("❌ status:", err?.message);
//     return res.status(500).json({ ok: false, error: "Server error" });
//   }
// });
// module.exports = router;