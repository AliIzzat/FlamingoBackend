const express = require('express');
const router = express.Router();
const Customer = require('../../models/Customer'); // adjust path if needed

// Lookup customer by phone
router.post('/lookup', async (req, res) => {
const { phone } = req.body;

try {
  const customer = await Customer.findOne({ phone }).lean();

   if (customer) {
     return res.json({ success: true, customer });
   } else {
         return res.json({ success: false });
 }
  } catch (err) {
   console.error("❌ Customer lookup error:", err);
  res.status(500).json({ success: false, error: "Server error" });
 }
});

module.exports = router;
