// middleware/driverAuth.js
const jwt = require("jsonwebtoken");

module.exports = function driverAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({ success: false, error: "NO_TOKEN" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // decoded should contain: { id, role, iat, exp }
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "INVALID_TOKEN" });
  }
};
