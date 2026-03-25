const express = require("express");
const router = express.Router();
const User = require("../../models/User");

router.get("/me", async (req, res) => {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized",
      });
    }

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    return res.json(user);
  } catch (err) {
    console.error("❌ GET /api/users/me error:", err.message);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
});

module.exports = router;