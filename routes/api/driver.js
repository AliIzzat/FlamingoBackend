const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../../models/User"); // ✅ adjust if needed

router.post("/login", async (req, res) => {
  console.log("➡️ DRIVER LOGIN HIT");
  console.log("content-type =", req.headers["content-type"]);
  console.log("body =", req.body);

  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        error: "username and password are required",
      });
    }

    const cleanUsername = String(username).trim();

    // ✅ Must be a DRIVER account
    const user = await User.findOne({
      username: cleanUsername,
      role: "driver",
    }).lean();

    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const stored = user.password || "";
    const isHashed = stored.startsWith("$2"); // bcrypt hashes start with $2...

    const match = isHashed
      ? await bcrypt.compare(password, stored)
      : String(password) === stored;

    if (!match) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const secret = process.env.JWT_SECRET || process.env.DRIVER_JWT_SECRET;
    if (!secret) {
      return res
        .status(500)
        .json({ ok: false, error: "JWT secret missing on server" });
    }

    const token = jwt.sign(
      { id: String(user._id), role: "driver" },
      secret,
      { expiresIn: "30d" }
    );

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
    console.error("💥 DRIVER LOGIN CRASH:", err?.message);
    console.error(err?.stack);
    return res.status(500).json({
      ok: false,
      error: "Server error",
      debug: err?.message, // keep temporarily while debugging
    });
  }
});

module.exports = router;