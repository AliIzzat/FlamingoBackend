const mongoose = require("mongoose");
const Order = require("../../models/Order");
const driverAuth = require("../../middleware/driverAuth");

// quick ping
router.get("/ping", (_req, res) => {
  res.json({ ok: true, service: "driver", time: new Date().toISOString() });
});

// GET available orders (Pending + unassigned)
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

    const driverId = req.user?.id; // from JWT
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
    ).lean();

    if (!updated) {
      return res.status(409).json({ ok: false, error: "Order already claimed (or not pending)." });
    }

    return res.json({ ok: true, order: updated });
  } catch (err) {
    console.error("❌ claim:", err?.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// GET my orders (assigned to this driver)
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

// POST update status (Claimed->PickedUp->Delivered)
router.post("/orders/:id/status", driverAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!["PickedUp", "Delivered", "Cancelled"].includes(status)) {
      return res.status(400).json({ ok: false, error: "Invalid status" });
    }

    const driverId = req.user?.id;

    const order = await Order.findOne({ _id: id, "delivery.assignedDriverId": driverId });
    if (!order) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }

    // basic transition rules
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
    return res.json({ ok: true, order: order.toObject() });
  } catch (err) {
    console.error("❌ status:", err?.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});







// const express = require("express");
// const router = express.Router();
// const jwt = require("jsonwebtoken");
// const bcrypt = require("bcryptjs");
// const User = require("../../models/User"); // ✅ adjust if needed

// const driverAuth = require("../../middleware/driverAuth");
// const Order = require("../../models/Order"); // adjust path/name if different

// router.get("/orders/available", driverAuth, async (req, res) => {
//   try {
//     const orders = await Order.find({
//       "delivery.status": "Pending",
//       "delivery.assignedDriverId": null,
//     })
//       .sort({ createdAt: -1 })
//       .lean();

//     return res.json({ ok: true, orders });
//   } catch (e) {
//     console.error("❌ available orders:", e);
//     return res.status(500).json({ ok: false, error: "Server error" });
//   }
// });

// router.get("/orders/my", driverAuth, async (req, res) => {
//   try {
//     const orders = await Order.find({
//       "delivery.assignedDriverId": req.driverObjectId,
//     })
//       .sort({ "delivery.claimedAt": -1, createdAt: -1 })
//       .lean();

//     return res.json({ ok: true, orders });
//   } catch (e) {
//     console.error("❌ my orders:", e);
//     return res.status(500).json({ ok: false, error: "Server error" });
//   }
// });

// router.post("/login", async (req, res) => {
//   console.log("➡️ DRIVER LOGIN HIT");
//   console.log("content-type =", req.headers["content-type"]);
//   console.log("body =", req.body);
//   console.log("JWT_SECRET exists?", !!process.env.JWT_SECRET);
//   console.log("JWT_SECRET length:", process.env.JWT_SECRET?.length);
//   console.log("All env keys sample:", Object.keys(process.env).slice(0, 20));

//   try {
//     const { username, password } = req.body || {};

//     if (!username || !password) {
//       return res.status(400).json({
//         ok: false,
//         error: "username and password are required",
//       });
//     }

//     const cleanUsername = String(username).trim();

//     // ✅ Must be a DRIVER account
//     const user = await User.findOne({
//       username: cleanUsername,
//       role: "driver",
//     }).lean();

//     if (!user) {
//       return res.status(401).json({ ok: false, error: "Invalid credentials" });
//     }

//     const stored = user.password || "";
//     const isHashed = stored.startsWith("$2"); // bcrypt hashes start with $2...

//     const match = isHashed
//       ? await bcrypt.compare(password, stored)
//       : String(password) === stored;

//     if (!match) {
//       return res.status(401).json({ ok: false, error: "Invalid credentials" });
//     }

//     const secret = process.env.JWT_SECRET || process.env.DRIVER_JWT_SECRET;
//     if (!secret) {
//       return res
//         .status(500)
//         .json({ ok: false, error: "JWT secret missing on server" });
//     }

//     const token = jwt.sign(
//       { id: String(user._id), role: "driver" },
//       secret,
//       { expiresIn: "30d" }
//     );

//     return res.json({
//       ok: true,
//       token,
//       driver: {
//         id: String(user._id),
//         name: user.name || user.username,
//         username: user.username,
//         role: user.role,
//       },
//     });
//   } catch (err) {
//     console.error("💥 DRIVER LOGIN CRASH:", err?.message);
//     console.error(err?.stack);
//     return res.status(500).json({
//       ok: false,
//       error: "Server error",
//       debug: err?.message, // keep temporarily while debugging
//     });
//   }
// });

// module.exports = router;