// routes/api/customer.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../../models/User");
const Customer = require("../../models/Customer");

function signToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing in .env");
  }
  return jwt.sign(
    { userId: String(user._id), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}
router.post("/save-address", async (req, res) => {
  try {

    console.log("🔥 /api/customer/save-address hit");
    console.log("🔥 req.body =", req.body);

    const {
      name,
      phone,
      addressText,
      streetNumber,
      zone,
      building,
      floor,
      aptNo,
      lat,
      lng,
    } = req.body;

    if (!phone || !phone.trim()) {
      return res.status(400).json({
        success: false,
        message: "Phone is required",
      });
    }

    const customer = await Customer.findOneAndUpdate(
      { phone: phone.trim() },
      {
        $set: {
          name: name?.trim() || "",
          addressText: addressText?.trim() || "",
          streetNumber: streetNumber?.trim() || "",
          zone: zone?.trim() || "",
          building: building?.trim() || "",
          floor: floor?.trim() || "",
          aptNo: aptNo?.trim() || "",
          location: {
            lat: lat ?? null,
            lng: lng ?? null,
          },
        },
      },
      {
        new: true,
        upsert: true, // 🔥 create if not exists
      }
    );

    console.log("🔥 saved customer =", customer);
    res.json({
      success: true,
      customer,
    });
  } catch (error) {
    console.error("save-address error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save address",
    });
  }
});
module.exports = router;
