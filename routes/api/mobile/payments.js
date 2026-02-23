// routes/api/mobile/payments.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const Order = require("../../../models/Order");
const mongoose = require("mongoose");

const MF_BASE = process.env.MF_API_URL || "https://apitest.myfatoorah.com";

router.post("/myfatoorah/initiate", async (req, res) => {
  try {
    const {
      orderId,
      totalAmount,
      customerName,
      customerEmail,
      customerMobile,
      paymentMethodId, // ✅ we will use this
    } = req.body;

    if (!orderId || !totalAmount) {
      return res
        .status(400)
        .json({ ok: false, error: "orderId and totalAmount are required" });
    }

    const methodId = Number(paymentMethodId || 2); // ✅ default VISA/MASTER
    const baseUrl = process.env.APP_BASE_URL || "http://localhost:4000";

    const CallBackUrl = `${baseUrl}/api/mobile/payments/myfatoorah/callback?orderId=${encodeURIComponent(
      orderId
    )}`;
    const ErrorUrl = `${baseUrl}/api/mobile/payments/myfatoorah/error?orderId=${encodeURIComponent(
      orderId
    )}`;
   console.log("🔗 CallBackUrl:", CallBackUrl);

    const payload = {
      PaymentMethodId: methodId, // ✅ USE IT (NOT hardcoded)
      InvoiceValue: Number(totalAmount),
      CustomerName: customerName || "Customer",
      DisplayCurrencyIso: "KWD",
      MobileCountryCode: "+965", // ✅ Kuwait country code
      CustomerMobile: customerMobile || "00000000",
      CustomerEmail: customerEmail || "test@example.com",
      CallBackUrl,
      ErrorUrl,
      Language: "en",
    };

    console.log("💳 Initiate payload:", payload);
    console.log("🔑 MF_TOKEN exists?", !!process.env.MF_TOKEN);

    const r = await axios.post(`${MF_BASE}/v2/ExecutePayment`, payload, {
      headers: {
        Authorization: `Bearer ${process.env.MF_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 25000,
    });

    const data = r.data?.Data;

    // ✅ Save invoiceId on the order immediately
    if (data?.InvoiceId) {
      await Order.findByIdAndUpdate(orderId, {
        "payment.invoiceId": String(data.InvoiceId),
      });
    }

    return res.json({
      ok: true,
      paymentUrl: data?.PaymentURL,
      invoiceId: data?.InvoiceId,
    });
  } catch (err) {
    const details = err?.response?.data || { message: err.message };
    console.error("❌ initiate error:", details);
    return res
      .status(500)
      .json({ ok: false, error: "initiate failed", details });
  }
});

router.get("/myfatoorah/callback", async (req, res) => {
  console.log("✅✅ CALLBACK HIT ✅✅", new Date().toISOString(), req.query);

  const orderId = req.query.orderId;
  const paymentId = req.query.paymentId || req.query.PaymentId || req.query.Id;

  if (!orderId) return res.status(400).send("Missing orderId");
  if (!paymentId) return res.status(400).send("Missing paymentId");

  // 1) VERIFY PAYMENT (MyFatoorah)
  let data;
  try {
    const response = await axios.post(
      `${MF_BASE}/v2/GetPaymentStatus`,
      { Key: paymentId, KeyType: "PaymentId" },
      {
        headers: {
          Authorization: `Bearer ${process.env.MF_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 25000,
      }
    );

    data = response.data?.Data;
  } catch (err) {
    const details = err?.response?.data || { message: err.message };
    console.error("❌ GetPaymentStatus FAILED:", details);
    return res.status(500).send("Payment verification failed (GetPaymentStatus).");
  }

  const isPaid = data?.InvoiceStatus === "Paid";
  console.log("✅ Payment status:", data?.InvoiceStatus, "InvoiceId:", data?.InvoiceId);

  // 2) UPDATE ORDER (Mongo)
  try {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      console.error("❌ Invalid Mongo orderId:", orderId);
      // Still show success to user (payment is verified), but you must fix orderId passing.
      return res.send(isPaid ? "✅ Payment successful (orderId invalid, not saved)." : "❌ Payment not completed.");
    }

    await Order.findByIdAndUpdate(orderId, {
      "payment.status": isPaid ? "paid" : "failed",
      "payment.paymentId": String(paymentId),
      "payment.invoiceId": String(data?.InvoiceId || ""),
      ...(isPaid ? { "delivery.status": "Pending" } : {}),
    });

  } catch (err) {
    console.error("❌ Mongo update FAILED:", err.message);
    // Payment verified, but DB didn’t update
    return res.status(500).send("Payment verified but saving order failed.");
  }

  return res.send(isPaid ? "✅ Payment successful. Return to the app." : "❌ Payment not completed.");
});
router.get("/myfatoorah/error", async (req, res) => {
  try {
    console.log("❌ MyFatoorah error query:", req.query);

    const orderId = req.query.orderId;
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, { "payment.status": "failed" });
    }

    return res.send("❌ Payment failed or cancelled.");
  } catch (err) {
    console.error("❌ Error route failed:", err.message);
    return res.status(500).send("Error handler failed.");
  }
});

module.exports = router;
