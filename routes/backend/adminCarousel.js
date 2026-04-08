// routes/backend/adminCarousel.js
const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.render("backend/carousel", {
    layout: "backend-layout",
    title: "Carousel Manager",
  });
});

module.exports = router;