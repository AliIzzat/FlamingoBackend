const express = require("express");
const router = express.Router();
const User = require("../../../models/User");

// Replace this with your real auth middleware if you already have one
const requireCustomerAuth = async (req, res, next) => {
  try {
    // Example only:
    // req.userId should come from JWT/session middleware
    if (!req.userId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }
};

router.get("/profile", requireCustomerAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).lean();

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    return res.json({
      ok: true,
      user: {
        _id: user._id,
        username: user.username || "",
        email: user.email || "",
        mobile: user.mobile || "",
        location: {
          lat: user.location?.lat ?? null,
          lng: user.location?.lng ?? null,
          address: user.location?.address || "",
          shortAddress: user.location?.shortAddress || "",
        },
      },
    });
  } catch (error) {
    console.log("❌ GET /profile error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
});

router.put("/profile/location", requireCustomerAuth, async (req, res) => {
  try {
    const { lat, lng, address, shortAddress } = req.body;

    const updated = await User.findByIdAndUpdate(
      req.userId,
      {
        $set: {
          "location.lat": lat,
          "location.lng": lng,
          "location.address": address || "",
          "location.shortAddress": shortAddress || "",
        },
      },
      { new: true }
    ).lean();

    return res.json({
      ok: true,
      message: "Location updated",
      location: updated.location,
    });
  } catch (error) {
    console.log("❌ PUT /profile/location error:", error);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
});

module.exports = router;