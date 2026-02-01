const express = require('express');
const router = express.Router();
//----------------------------  Intro page --------------------------------
router.get("/", async (req, res) => {
  try {
    res.render('frontend/introduction', {
      layout: "main",
      hideLayout: true,
      hideHeader: true,
      hideFooter: true,
    });
  } catch {
    console.error("❌ Failed to render", err);
  }
});
router.get("/", (req, res) => {
  res.render('frontend/introduction'); // Show the intro page first
});
module.exports = router;
