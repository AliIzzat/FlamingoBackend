// routes/backend/auth.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const User = require("../../models/User");

// GET: show login form
router.get("/login", (req, res) => {
  return res.render("frontend/login", {
    layout: false,
    error: null,
  });
});

// POST: handle login
router.post("/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();

  try {
    if (!username || !password) {
      return res.render("frontend/login", {
        layout: false,
        error: "❌ Username and password are required",
      });
    }

     const user = await User.findOne({ username });

      if (!user) {
        return res.render("frontend/login", {
          layout: false,
          error: "❌ Invalid username or password",
        });
      }

      let isMatch = false;

      // bcrypt hashed password
      if (
        typeof user.password === "string" &&
        (user.password.startsWith("$2a$") ||
          user.password.startsWith("$2b$") ||
          user.password.startsWith("$2y$"))
      ) {
        isMatch = await bcrypt.compare(password, user.password);
      } else {
        // old plain-text password
        isMatch = password === user.password;

        // auto-upgrade old plain-text password to bcrypt after successful login
        if (isMatch) {
          const hashedPassword = await bcrypt.hash(password, 10);
          user.password = hashedPassword;
          await user.save();
        }
      }

      if (!isMatch) {
        return res.render("frontend/login", {
          layout: false,
          error: "❌ Invalid username or password",
        });
      }

    req.session.userId = user._id;
    req.session.userRole = user.role;
    req.session.user = {
      _id: user._id,
      name: user.name || user.username,
      role: user.role,
    };

   if (process.env.NODE_ENV === "development") {
      console.log({
        name: user.name || user.username,
        role: user.role,
      });
    }

    return req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).send("Session error");
      }

      if (user.role === "admin" || user.role === "support") {
        return res.redirect("/admin");
      }

      if (user.role === "driver" || user.role === "delivery") {
        return res.render("frontend/login", {
          layout: false,
          error: "Drivers must login using the mobile app.",
        });
      }

      return res.redirect("/");
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).send("Server error during login");
  }
});

// LOGOUT
// router.get("/logout", (req, res) => {
//   req.session.destroy((err) => {
//     if (err) {
//       console.error("Logout error:", err);
//       return res.status(500).send("Error logging out.");
//     }
//     return res.redirect("/login");
//   });
// });
router.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).send("Error logging out.");
    }
    return res.redirect("/auth/login");
  });
});

// Step 1: Show form to enter phone
router.get("/enter-phone", (req, res) => {
  return res.render("enter-phone");
});

// Step 2: Send OTP
router.post("/send-otp", (req, res) => {
  const phone = String(req.body.phone || "").trim();

  if (!phone) {
    return res.status(400).send("Phone is required");
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  req.session.otp = otp;
  req.session.phone = phone;

  return res.redirect("/verify-otp");
});

// Step 3: Show OTP form
router.get("/verify-otp", (req, res) => {
  return res.render("verify-otp");
});

// Step 4: Verify OTP
router.post("/verify-otp", (req, res) => {
  const otp = String(req.body.otp || "").trim();

  if (otp === req.session.otp) {
    req.session.isVerified = true;
    return res.send(`✅ Phone verified: ${req.session.phone}`);
  }

  return res.send("❌ Invalid OTP. Please try again.");
});

// GET: show registration form
router.get("/register", (req, res) => {
  return res.render("frontend/register", {
    layout: false,
    title: "Customer Registration",
  });
});

// POST: handle registration form submission
router.post("/register", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim();
  const phone = String(req.body.phone || "").trim();

  req.session.customerInfo = { name, email, phone };

  return res.redirect("/order/confirm");
});

module.exports = router;
