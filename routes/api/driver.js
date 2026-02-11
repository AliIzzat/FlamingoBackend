// routes/api/driver.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const Order = require("../../models/Order");
const User = require("../../models/User");

// --------------------
// JWT helpers
// --------------------
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing in environment`);
  return v;
}

function signDriverToken(driver) {
  const secret = mustEnv("JWT_SECRET");
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(
    { userId: String(driver._id), role: "driver" },
    secret,
    { expiresIn }
  );
}

function requireDriverJWT(req, res, next) {
  try {
    const auth = req.header("authorization") || "";
    const [type, token] = auth.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({ ok: false, error: "Missing Bearer token" });
    }

    const secret = mustEnv("JWT_SECRET");
    const payload = jwt.verify(token, secret);

    if (payload?.role !== "driver") {
      return res.status(403).json({ ok: false, error: "Not a driver token" });
    }

    if (!mongoose.Types.ObjectId.isValid(payload?.userId)) {
      return res.status(401).json({ ok: false, error: "Invalid token user" });
    }

    req.driverObjectId = new mongoose.Types.ObjectId(payload.userId);
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid/expired token" });
  }
}

// --------------------
// Status enum
// --------------------
const STATUS = {
  Pending: "Pending",
  Claimed: "Claimed",
  PickedUp: "PickedUp",
  Delivered: "Delivered",
  Cancelled: "Cancelled",
};

function attachCoords(order) {
  order.customerLat = order.customer?.location?.lat ?? null;
  order.customerLng = order.customer?.location?.lng ?? null;
  order.pickupLat = order.pickup?.location?.lat ?? null;
  order.pickupLng = order.pickup?.location?.lng ?? null;
  return order;
}

// --------------------
// POST /api/driver/login
// Body: { username, password }
// --------------------
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "username and password are required" });
    }

    const driver = await User.findOne({
      username,
      password,          // TODO: replace with bcrypt later
      role: "driver",
    }).lean();

    if (!driver) return res.status(401).json({ ok: false, error: "Invalid login" });

    const token = signDriverToken(driver);
    return res.json({
      ok: true,
      token,
      //driver: { id: driver._id, name: driver.name || driver.username },
      driver: { id: String(driver._id), name: driver.name || driver.username }
    });
  } catch (e) {
    console.error("❌ driver login:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ✅ GET /api/driver/orders/available
router.get("/orders/available", requireDriverJWT, async (_req, res) => {
  try {
    const orders = await Order.find({
      "delivery.status": STATUS.Pending,
      "delivery.assignedDriverId": null,
    })
      .sort({ createdAt: -1 })
      .lean();

    orders.forEach(attachCoords);
    return res.json({ ok: true, orders });
  } catch (e) {
    console.error("❌ driver available:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ✅ POST /api/driver/orders/:id/claim (atomic)
router.post("/orders/:id/claim", requireDriverJWT, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "Invalid order id" });
    }

    const updated = await Order.findOneAndUpdate(
      {
        _id: id,
        "delivery.status": STATUS.Pending,
        "delivery.assignedDriverId": null,
      },
      {
        $set: {
          "delivery.status": STATUS.Claimed,
          "delivery.assignedDriverId": req.driverObjectId,
          "delivery.claimedAt": new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(409).json({ ok: false, error: "Order already claimed (or not pending)." });
    }

    return res.json({ ok: true, order: attachCoords(updated) });
  } catch (e) {
    console.error("❌ driver claim:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ✅ GET /api/driver/orders/my
router.get("/orders/my", requireDriverJWT, async (req, res) => {
  try {
    const orders = await Order.find({
      "delivery.assignedDriverId": req.driverObjectId,
      "delivery.status": { $in: [STATUS.Claimed, STATUS.PickedUp, STATUS.Delivered] },
    })
      .sort({ createdAt: -1 })
      .lean();

    orders.forEach(attachCoords);
    return res.json({ ok: true, orders });
  } catch (e) {
    console.error("❌ driver my:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ✅ POST /api/driver/orders/:id/status
router.post("/orders/:id/status", requireDriverJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "Invalid order id" });
    }

    const allowed = [STATUS.PickedUp, STATUS.Delivered];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: "Invalid status" });
    }

    const mustCurrentlyBe = status === STATUS.PickedUp ? STATUS.Claimed : STATUS.PickedUp;

    const patch = { "delivery.status": status };
    if (status === STATUS.PickedUp) patch["delivery.pickedUpAt"] = new Date();
    if (status === STATUS.Delivered) patch["delivery.deliveredAt"] = new Date();

    const updated = await Order.findOneAndUpdate(
      {
        _id: id,
        "delivery.assignedDriverId": req.driverObjectId,
        "delivery.status": mustCurrentlyBe,
      },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(409).json({
        ok: false,
        error: "Order not found for this driver, or invalid transition.",
      });
    }

    return res.json({ ok: true, order: attachCoords(updated) });
  } catch (e) {
    console.error("❌ driver status:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/push-token", requireDriverJWT, async (req, res) => {
  const { expoPushToken } = req.body || {};
  if (!expoPushToken) return res.status(400).json({ ok: false, error: "Missing token" });

  await User.findByIdAndUpdate(req.driverObjectId, {
    $set: { expoPushToken },
  });

  return res.json({ ok: true });
});

module.exports = router;