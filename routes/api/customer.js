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
    //  phone,
      addressText,
      streetNumber,
      zone,
      building,
      floor,
      aptNo,
      lat,
      lng,
    } = req.body;
    const customer = await Customer.findOneAndUpdate(
       { name: "Test User" },   // filter
    {  
     $set: {
          name: "Test User",
          addressText: "Street 12, Zone Lusail",
          streetNumber: "12",
          zone: "Lusail",
          building: "8",
          floor: "2",
          aptNo: "5",
          location: {
            lat: 25.4,
            lng: 51.5,
          },
        },
      },
      {
        new: true,
        upsert: true,
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
    message: error.message,
    stack: error.stack,
  });
}
});
module.exports = router;
