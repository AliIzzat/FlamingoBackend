// middleware/auth.js

// ✅ Must be logged in (session exists)
function requireLogin(req, res, next) {
  if (req.session?.userId || req.session?.user?._id) return next();
  return res.redirect("/auth/login");
}

// ✅ Role-based guard: require one of the given roles
// Usage:
//   requireRole("admin")
//   requireRole(["admin", "support"])
function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    const role = req.session?.userRole || req.session?.user?.role;

    if (role && allowed.includes(role)) return next();

    return res.status(403).send("Not authorized for this area");
  };
}

/* ============================================================
   Convenience middleware
   ============================================================ */

// If you standardize to "driver" instead of "delivery", use driver.
// If your DB still has "delivery", keep it too.
const isAdmin = requireRole(["admin"]);
const isSupport = requireRole(["admin", "support"]);
const isDataEntry = requireRole(["admin", "data_entry"]);
const isDriver = requireRole(["driver", "delivery"]); // supports both

module.exports = {
  requireLogin,
  requireRole,

  // convenience
  isAdmin,
  isSupport,
  isDataEntry,
  isDriver,
};



