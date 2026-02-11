// middleware/authJwt.js
const jwt = require("jsonwebtoken");

function authJwt(requiredRole /* optional: "driver" | "customer" */) {
  return (req, res, next) => {
    try {
      const header = req.headers.authorization || "";
      const [type, token] = header.split(" ");

      if (type !== "Bearer" || !token) {
        return res.status(401).json({ error: "Missing or invalid Authorization header" });
      }

      const payload = jwt.verify(token, process.env.JWT_SECRET);

      // payload should include: { userId, role }
      req.user = payload;

      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ error: "Forbidden" });
      }

      next();
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

module.exports = authJwt;
