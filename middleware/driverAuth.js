// middleware/driverAuth.js
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

module.exports = function driverAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({ ok: false, error: "NO_TOKEN" });
    }

    const secret = process.env.JWT_SECRET || process.env.DRIVER_JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ ok: false, error: "JWT secret missing on server" });
    }

    const decoded = jwt.verify(token, secret);

    // must be driver
    if (!decoded?.id) {
      return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
    }
    if (decoded.role !== "driver") {
      return res.status(403).json({ ok: false, error: "NOT_DRIVER" });
    }

    // attach to req
    req.user = decoded;
    req.driverId = String(decoded.id);
    req.driverObjectId = new mongoose.Types.ObjectId(decoded.id);

    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
  }
};