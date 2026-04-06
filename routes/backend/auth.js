// routes/backend/auth.js
const express = require("express");
const router = express.Router();
const User = require("../../models/User");

// GET: show login form
// router.get("/login", (req, res) => {
//   res.render("frontend/login", {
//     layout: false,
//     error: null,
//   });
// });

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  // 🔒 SAFE LOGGING (dev only, no password)
  if (process.env.NODE_ENV === "development") {
    console.log("POST /login attempt:", {
      username: req.body.username,
    });
  }

  try {
    const user = await User.findOne({ username, password }); // (later: use bcrypt)

    if (!user) {
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

    console.log("🟩 Session after login (before save):", {
      userId: String(req.session.userId),
      userRole: req.session.userRole,
      user: req.session.user,
    });

    return req.session.save((err) => {
      if (err) {
        console.error("❌ Session save error:", err);
        return res.status(500).send("Session error");
      }

      console.log("🟩 Session saved OK");
      console.log("🟢 Logged in as:", user.username, "role:", user.role);

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
    console.error("❌ Login error:", err);
    return res.status(500).send("Server error during login");
  }
});


// POST: handle login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

 if (process.env.NODE_ENV === "development") {
  console.log("POST /login attempt:", {
    username: req.body.username,
  });
}

  try {
    const user = await User.findOne({ username, password }); // (later: use bcrypt)

    if (!user) {
      return res.render("frontend/login", {
        layout: false,
        error: "❌ Invalid username or password",
      });
    }

    // ✅ STORE SESSION INFO HERE
    req.session.userId = user._id;
    req.session.userRole = user.role;
    req.session.user = {
      _id: user._id,
      name: user.name || user.username,
      role: user.role,
    };

    console.log("🟩 Session after login (before save):", {
      userId: String(req.session.userId),
      userRole: req.session.userRole,
      user: req.session.user,
    });

    // ✅ IMPORTANT: save session before redirect
    return req.session.save((err) => {
      if (err) {
        console.error("❌ Session save error:", err);
        return res.status(500).send("Session error");
      }

      console.log("🟩 Session saved OK");
      console.log("🟢 Logged in as:", user.username, "role:", user.role);

      // ✅ Redirect based on role
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
    console.error("❌ Login error:", err);
    return res.status(500).send("Server error during login");
  }
});

// LOGOUT
router.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("❌ Logout error:", err);
      return res.status(500).send("Error logging out.");
    }
    res.redirect("/auth/login");
  });
});
// Step 1: Show form to enter phone
router.get('/enter-phone', (req, res) => {
  res.render('enter-phone'); // create this view
});

// Step 2: Send OTP
router.post('/send-otp', (req, res) => {
  const { phone } = req.body;

  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP

  req.session.otp = otp;
  req.session.phone = phone;

  res.redirect('/verify-otp');
});

// Step 3: Show OTP form
router.get('/verify-otp', (req, res) => {
  res.render('verify-otp'); // create this view
});

// Step 4: Verify OTP
router.post('/verify-otp', (req, res) => {
  const { otp } = req.body;

  if (otp === req.session.otp) {
    // ✅ Phone verified
    req.session.isVerified = true;

    // You can save to DB here
    res.send(`✅ Phone verified: ${req.session.phone}`);
  } else {
    res.send('❌ Invalid OTP. Please try again.');
  }
});
// GET: show registration form
router.get('/register', (req, res) => {
  res.render('frontend/register', {
    layout: false,                // set to your main layout if you want header/footer
    title: 'Customer Registration'
  });
});
// POST: handle registration form submission
router.post('/register', (req, res) => {
  const { name, email, phone } = req.body;

  // store in session (so confirm-order can use it)
  req.session.customerInfo = { name, email, phone };

  // continue to confirm order
  res.redirect('/order/confirm');
});

module.exports = router;
