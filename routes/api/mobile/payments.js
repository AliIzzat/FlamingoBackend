// routes/api/mobile/payments.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const Order = require("../../../models/Order");

// ✅ Token: support both naming styles
const MF_TOKEN =
  process.env.MYFATOORAH_API_KEY || // Railway variable you already have
  process.env.MYFATOORAH_TOKEN ||
  process.env.MF_TOKEN;

// ✅ Base URL: support both naming styles
const MF_BASE_RAW =
  process.env.MYFATOORAH_API_BASE || // Railway variable you already have
  process.env.MF_API_URL ||
  process.env.MYFATOORAH_API_URL ||
  "https://apitest.myfatoorah.com";

const MF_BASE = MF_BASE_RAW.replace(/\/+$/, "").replace(/\/v2$/, "");

// ✅ Read token from any supported env name
const MF_TOKEN =
  process.env.MYFATOORAH_API_KEY ||     // ✅ what Railway currently has
  process.env.MYFATOORAH_TOKEN ||
  process.env.MF_TOKEN;

// ✅ Read base URL from any supported env name
const MF_BASE_RAW =
  process.env.MYFATOORAH_API_BASE ||    // ✅ what Railway currently has
  process.env.MF_API_URL ||
  process.env.MYFATOORAH_API_URL ||
  "https://apitest.myfatoorah.com";

const MF_BASE = MF_BASE_RAW
  .replace(/\/+$/, "")   // remove trailing slashes
  .replace(/\/v2$/, ""); // remove trailing /v2 if present

router.post("/myfatoorah/initiate", async (req, res) => {
  try {
    if (!MF_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "MyFatoorah token missing on server",
        hint: "Set MYFATOORAH_API_KEY (or MYFATOORAH_TOKEN / MF_TOKEN) in Railway",
      });
    }

    const {
      orderId,
      totalAmount,
      customerName,
      customerEmail,
      customerMobile,
      paymentMethodId,
    } = req.body;

    if (!orderId || !totalAmount) {
      return res
        .status(400)
        .json({ ok: false, error: "orderId and totalAmount are required" });
    }

    const methodId = Number(paymentMethodId || 2);
    const baseUrl = process.env.APP_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:4000";

    const CallBackUrl = `${baseUrl}/api/mobile/payments/myfatoorah/callback?orderId=${encodeURIComponent(orderId)}`;
    const ErrorUrl = `${baseUrl}/api/mobile/payments/myfatoorah/error?orderId=${encodeURIComponent(orderId)}`;

    const payload = {
      PaymentMethodId: methodId,
      InvoiceValue: Number(totalAmount),
      CustomerName: customerName || "Customer",
      DisplayCurrencyIso: "KWD",
      MobileCountryCode: "+965",
      CustomerMobile: customerMobile || "00000000",
      CustomerEmail: customerEmail || "test@example.com",
      CallBackUrl,
      ErrorUrl,
      Language: "en",
    };

    const r = await axios.post(`${MF_BASE}/v2/ExecutePayment`, payload, {
      headers: {
        Authorization: `Bearer ${MF_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 25000,
    });

    const data = r.data?.Data;

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
    const status = err?.response?.status;
    const details = err?.response?.data || { message: err.message };
    return res.status(status || 500).json({ ok: false, status, details });
  }
});

// ------------------------
// CALLBACK (SUCCESS)
// ------------------------
router.get("/myfatoorah/callback", async (req, res) => {
  console.log("✅✅ CALLBACK HIT ✅✅", new Date().toISOString());
  console.log("🔎 query =", req.query);

  try {
    const orderId = req.query.orderId;
    const paymentId = req.query.paymentId || req.query.PaymentId || req.query.Id;

    if (!orderId) return res.status(400).send("Missing orderId");
    if (!paymentId) return res.status(400).send("Missing paymentId");

    console.log("➡️ verifying paymentId =", paymentId);
    console.log("MF_BASE =", MF_BASE);
    console.log("MYFATOORAH_TOKEN length =", MF_TOKEN.length);

    if (!MF_TOKEN) {
      return res.status(500).send("Server missing MYFATOORAH_TOKEN.");
    }

    const response = await axios.post(
      `${MF_BASE}/v2/GetPaymentStatus`,
      { Key: paymentId, KeyType: "PaymentId" },
      {
        headers: MF_HEADERS,
        timeout: 25000,
      }
    );

    console.log("✅ GetPaymentStatus HTTP =", response.status);
    console.log("✅ GetPaymentStatus body =", response.data?.Message, "IsSuccess:", response.data?.IsSuccess);

    const data = response.data?.Data;
    const isPaid = data?.InvoiceStatus === "Paid";

    await Order.findByIdAndUpdate(orderId, {
      "payment.status": isPaid ? "paid" : "failed",
      "payment.paymentId": String(paymentId),
      "payment.invoiceId": String(data?.InvoiceId || ""),
      ...(isPaid ? { "delivery.status": "Pending" } : {}),
    });

    return res.send(
      isPaid
        ? "✅ Payment successful. Return to the app."
        : `❌ Payment not completed. Status: ${data?.InvoiceStatus || "Unknown"}`
    );
  } catch (err) {
    console.log("❌❌ GetPaymentStatus FAILED ❌❌");
    console.log("status =", err?.response?.status);
    console.log("data =", err?.response?.data);
    console.log("message =", err?.message);

    return res.status(500).send(
      `Payment verification failed.\n\nstatus=${err?.response?.status}\nmessage=${err?.message}\n\n${JSON.stringify(
        err?.response?.data || {},
        null,
        2
      )}`
    );
  }
});

// ------------------------
// ERROR (CANCEL / FAIL)
// ------------------------
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
