const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Absolute upload path (VERY IMPORTANT for Railway)
const uploadPath = path.join(__dirname, "..", "public", "uploads");

// Ensure folder exists
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, name + ext);
  }
});

const upload = multer({ storage });

module.exports = upload;