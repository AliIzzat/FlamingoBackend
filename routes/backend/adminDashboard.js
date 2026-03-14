const express = require("express");
const router = express.Router();
const Notification = require("../../models/Notification");

const Category = require("../../models/Category");

router.get("/", (req, res) => res.redirect("/admin/dashboard"));

router.get("/dashboard", async (req, res) => {
  try {
    const notifications = await Notification.find({})
      .sort({ createdAt: -1 })
      .populate("orderId")
      .populate("driverId", "username name")
      .lean();

    return res.render("backend/dashboard", {
      layout: "backend-layout",
      title: "Dashboard",
      notifications,
      user: req.session.user || null,
    });
  } catch (err) {
    console.error("❌ dashboard error:", err);
    return res.status(500).send("Failed to load dashboard");
  }
});

// router.get("/dashboard", async (req, res) => {
//   try {
//     const [notifications, categories] = await Promise.all([
//       Notification.find().sort({ createdAt: -1 }).limit(50).lean(),
//       Category.find({ isActive: true }).sort({ sortOrder: 1, name_en: 1 }).lean(),
//     ]);

//     res.render("backend/dashboard", {
//       layout: "backend-layout",
//       title: "Admin Dashboard",
//       user: req.session.user,
//       notifications,
//       categories, // ✅ send to view
//     });
//   } catch (e) {
//     console.error("❌ admin dashboard:", e);
//     res.status(500).send("Failed to load dashboard");
//   }
// });
module.exports = router;