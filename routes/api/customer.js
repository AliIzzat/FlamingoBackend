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
    console.log("🔥 HIT /save-address");
    console.log("🔥 BODY =", req.body);

    const { addressText, lat, lng } = req.body;

    if (!addressText || !addressText.trim()) {
      return res.status(400).json({
        success: false,
        message: "Address is required",
      });
    }

    const customer = await Customer.create({
      addressText: addressText.trim(),
      location: {
        lat: lat ?? null,
        lng: lng ?? null,
      },
    });

    console.log("✅ SAVED =", customer);

    res.json({
      success: true,
      customer,
    });
  } catch (error) {
    console.error("❌ ERROR:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});
module.exports = router;
