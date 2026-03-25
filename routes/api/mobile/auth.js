const express = require("express");
const router = express.Router();
const User = require("../../../models/User");

// POST /api/mobile/auth/register
router.post("/register", async (req, res) => {
  try {
    const mobile = String(req.body.mobile || "")
      .replace(/\s+/g, "")
      .trim();

    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();

    if (!name || !mobile || !password) {
      return res.status(400).json({
        ok: false,
        message: "Name, mobile, and password are required",
      });
    }

    const existingUser = await User.findOne({ mobile });

    if (existingUser) {
      return res.status(409).json({
        ok: false,
        message: "Mobile already registered",
      });
    }

    const user = await User.create({
      name,
      email,
      mobile,
      password,
      role: "customer",
    });

    req.session.userId = user._id;
    req.session.userRole = user.role;
    req.session.user = {
      _id: user._id,
      name: user.name,
      role: user.role,
      mobile: user.mobile,
    };

    req.session.save((err) => {
      if (err) {
        console.error("❌ Session save error:", err);
        return res.status(500).json({
          ok: false,
          message: "Session error",
        });
      }

      return res.json({
        ok: true,
        message: "Customer registered successfully",
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          mobile: user.mobile,
          role: user.role,
        },
      });
    });
  } catch (err) {
    console.error("❌ Mobile register error:", err);

    if (err?.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Mobile already exists",
      });
    }

    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
});

// POST /api/mobile/auth/login
router.post("/login", async (req, res) => {
  try {
    const mobile = String(req.body.mobile || "")
      .replace(/\s+/g, "")
      .trim();

    const password = String(req.body.password || "").trim();

    if (!mobile || !password) {
      return res.status(400).json({
        ok: false,
        message: "Mobile and password are required",
      });
    }

    const user = await User.findOne({ mobile, password });

    if (!user) {
      return res.status(401).json({
        ok: false,
        message: "Invalid mobile or password",
      });
    }

    req.session.userId = user._id;
    req.session.userRole = user.role;
    req.session.user = {
      _id: user._id,
      name: user.name,
      role: user.role,
      mobile: user.mobile,
    };

    req.session.save((err) => {
      if (err) {
        console.error("❌ Session save error:", err);
        return res.status(500).json({
          ok: false,
          message: "Session error",
        });
      }

      return res.json({
        ok: true,
        message: "Login successful",
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          mobile: user.mobile,
          role: user.role,
        },
      });
    });
  } catch (err) {
    console.error("❌ Mobile login error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
});

// GET /api/mobile/auth/logout
router.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("❌ Mobile logout error:", err);
      return res.status(500).json({
        ok: false,
        message: "Error logging out",
      });
    }

    return res.json({
      ok: true,
      message: "Logged out successfully",
    });
  });
});

module.exports = router;