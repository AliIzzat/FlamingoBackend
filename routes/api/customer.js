// routes/api/customer.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../../models/User");

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

// POST /api/customer/login
router.post("/login", async (req, res) => {
  try {
    // accept both keys: phone OR mobile (so Postman and mobile app both work)
    const mobileRaw = req.body.mobile ?? req.body.phone;

    const mobile = String(mobileRaw || "").trim();
    if (!mobile) {
      return res.status(400).json({ ok: false, error: "Mobile is required" });
    }

    const customer = await User.findOne({
      mobile,
      role: "customer",
      // remove isActive unless you add it to schema
    }).lean();

    if (!customer) {
      return res.status(401).json({ ok: false, error: "Invalid login" });
    }

    const token = signToken(customer);

    return res.json({
      ok: true,
      token,
      user: {
        id: customer._id,
        name: customer.name,
        role: customer.role,
      },
    });
  } catch (err) {
    console.error("❌ customer login:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;






// const express = require("express");
// const router = express.Router();
// const jwt = require("jsonwebtoken");
// const User = require("../../models/User");

// function signToken(user) {
//   return jwt.sign(
//     { userId: String(user._id), role: user.role },
//     process.env.JWT_SECRET,
//     { expiresIn: "7d" }
//   );
// }

// // POST /api/customer/login
// router.post("/login", async (req, res) => {
//   try {
//     const { phone } = req.body;

//     if (!phone) {
//       return res.status(400).json({ ok: false, error: "Phone is required" });
//     }

//     const customer = await User.findOne({
//       phone,
//       role: "customer",
//       isActive: true,
//     });

//     if (!customer) {
//       return res.status(401).json({ ok: false, error: "Invalid login" });
//     }

//     const token = signToken(customer);

//     return res.json({
//       ok: true,
//       token,
//       user: {
//         id: customer._id,
//         name: customer.name,
//         role: customer.role,
//       },
//     });
//   } catch (err) {
//     console.error("❌ customer login:", err);
//     return res.status(500).json({ ok: false, error: "Server error" });
//   }
// });

// module.exports = router;

