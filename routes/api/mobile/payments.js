// routes/api/mobile/payments.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const Order = require("../../../models/Order");
const mongoose = require("mongoose");

const MF_BASE = (process.env.MF_API_URL || "https://apitest.myfatoorah.com")
.replace(/\/+$/, "")      // remove trailing slashes
.replace(/\/v2$/, "");    // remove trailing /v2 if someone put it in env
const verifyUrl = `${MF_BASE}/v2/GetPaymentStatus`;

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
    console.log("🔑 MF_TOKEN exists?", !!process.env.MYFATOORAH_TOKEN);

    const r = await axios.post(`${MF_BASE}/v2/ExecutePayment`, payload, {
      headers: {
        Authorization: `Bearer ${process.env.process.env.MYFATOORAH_TOKEN}`,
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
  console.error("❌ initiate stack:", err?.stack);
  const status = err?.response?.status;
  const details = err?.response?.data || { message: err.message };

  console.error("❌ initiate error status:", status);
  console.error("❌ initiate error details:", details);

  return res.status(status || 500).json({
    ok: false,
    error: "initiate failed",
    status,
    details,
  });
}
});
router.get("/myfatoorah/callback", async (req, res) => {
  console.log("✅✅ CALLBACK HIT ✅✅", new Date().toISOString());
  console.log("🔎 query =", req.query);
  console.log("🔑 MF_TOKEN prefix:", process.env.MYFATOORAH_TOKEN?.slice(0, 10));

  try {
    const orderId = req.query.orderId;
    const paymentId = req.query.paymentId || req.query.PaymentId || req.query.Id;

    if (!orderId) return res.status(400).send("Missing orderId");
    if (!paymentId) return res.status(400).send("Missing paymentId");

    console.log("➡️ verifying paymentId =", paymentId);

    const response = await axios.post(
      `${MF_BASE}/v2/GetPaymentStatus`,
      { Key: paymentId, KeyType: "PaymentId" },
      {
        headers: {
          Authorization: `Bearer ${process.env.MYFATOORAH_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 25000,
      }
    );

    console.log("✅ GetPaymentStatus HTTP =", response.status);
    console.log("✅ GetPaymentStatus body =", response.data);

    const data = response.data?.Data;
    const isPaid = data?.InvoiceStatus === "Paid";

    await Order.findByIdAndUpdate(orderId, {
      "payment.status": isPaid ? "paid" : "failed",
      "payment.paymentId": String(paymentId),
      "payment.invoiceId": String(data?.InvoiceId || ""),
      ...(isPaid ? { "delivery.status": "Pending" } : {}),
    });

    return res.send(isPaid ? "✅ Payment successful. Return to the app." : "❌ Payment not completed.");
  } catch (err) {
    console.log("❌❌ GetPaymentStatus FAILED ❌❌");
    console.log("status =", err?.response?.status);
    console.log("data =", err?.response?.data);
    console.log("message =", err?.message);

    // IMPORTANT: show details in browser too (so you don't rely only on logs)
    return res.status(500).send(
      `Payment verification failed.\n\nstatus=${err?.response?.status}\nmessage=${err?.message}\n\n${JSON.stringify(
        err?.response?.data || {},
        null,
        2
      )}`
    );
  }
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
