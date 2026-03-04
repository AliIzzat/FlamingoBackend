// routes/api/mobile/payments.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const Order = require("../../../models/Order");
// ----------------------------
// ENV HELPERS
// ----------------------------
function pickFirst(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

// ✅ Token (supports all names)
const MF_TOKEN = pickFirst(
  process.env.MYFATOORAH_API_KEY,
  process.env.MYFATOORAH_TOKEN,
  process.env.MF_TOKEN
);

// ✅ Base URL (supports all names)
const MF_BASE_RAW = pickFirst(
  process.env.MYFATOORAH_API_BASE, // your Railway variable name
  process.env.MYFATOORAH_API_URL,
  process.env.MF_API_URL,
  "https://apitest.myfatoorah.com"
);

// ✅ Normalize base: remove trailing "/" + remove trailing "/v2"
const MF_BASE = MF_BASE_RAW.replace(/\/+$/, "").replace(/\/v2$/, "");

const MF_HEADERS = {
  Authorization: `Bearer ${MF_TOKEN}`,
  "Content-Type": "application/json",
};

// ✅ Your customer app scheme (must match app.json -> scheme)
const APP_SCHEME = pickFirst(process.env.MOBILE_SCHEME, "flamingdelivery");

// ✅ Public base URL for callback/error endpoints
function getPublicBaseUrl() {
  const appBase = pickFirst(process.env.APP_BASE_URL);
  if (appBase) return appBase.replace(/\/+$/, "");

  const pub = pickFirst(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (pub) return `https://${pub}`;

  return "http://localhost:4000";
}

function deepLinkSuccess(orderId) {
  return `${APP_SCHEME}://payment-success?orderId=${encodeURIComponent(orderId || "")}`;
}
function deepLinkFail(orderId, reason) {
  const r = reason ? `&reason=${encodeURIComponent(reason)}` : "";
  return `${APP_SCHEME}://payment-failed?orderId=${encodeURIComponent(orderId || "")}${r}`;
}

// ----------------------------
// INITIATE PAYMENT
// POST /api/mobile/payments/myfatoorah/initiate
// ----------------------------
router.post("/myfatoorah/initiate", async (req, res) => {
  console.log("🔥 HIT /myfatoorah/initiate", new Date().toISOString());
  console.log("MF_BASE =", MF_BASE);
  console.log("MF_TOKEN length =", (MF_TOKEN || "").length);

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
    } = req.body || {};

    if (!orderId || !totalAmount) {
      return res.status(400).json({
        ok: false,
        error: "orderId and totalAmount are required",
      });
    }

    const baseUrl = getPublicBaseUrl();
    const methodId = Number(paymentMethodId || 2);

    const CallBackUrl = `${baseUrl}/api/mobile/payments/myfatoorah/callback?orderId=${encodeURIComponent(
      orderId
    )}`;
    const ErrorUrl = `${baseUrl}/api/mobile/payments/myfatoorah/error?orderId=${encodeURIComponent(
      orderId
    )}`;

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
      headers: MF_HEADERS,
      timeout: 25000,
    });

    const data = r.data?.Data;

    // Save invoiceId if present
    if (data?.InvoiceId) {
      await Order.findByIdAndUpdate(orderId, {
        "payment.invoiceId": String(data.InvoiceId),
        "payment.method": "myfatoorah",
        "payment.status": "unpaid",
      });
    }

    if (!data?.PaymentURL) {
      return res.status(500).json({
        ok: false,
        error: "MyFatoorah did not return PaymentURL",
        details: r.data,
      });
    }

    return res.json({
      ok: true,
      paymentUrl: data.PaymentURL,
      invoiceId: data.InvoiceId,
    });
  } catch (err) {
    const status = err?.response?.status;
    const mfBody = err?.response?.data;

    console.log("❌ /initiate failed status =", status);
    console.log("❌ /initiate failed body =", JSON.stringify(mfBody, null, 2));

    return res.status(status || 500).json({
      ok: false,
      marker: "INITIATE_CATCH",
      status,
      details: mfBody || { message: err.message },
    });
  }
});
router.get("/status", async (req, res) => {
  try {
    const { invoiceId } = req.query;

    if (!invoiceId) {
      return res.status(400).json({ ok: false, error: "invoiceId missing" });
    }

    const response = await fetch(
      "https://apitest.myfatoorah.com/v2/GetPaymentStatus",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.MYFATOORAH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Key: invoiceId,
          KeyType: "InvoiceId",
        }),
      }
    );

    const data = await response.json();

    console.log("MF status:", data);

    const status = data?.Data?.InvoiceStatus;

    return res.json({
      ok: true,
      invoiceId,
      status,
      paid: status === "Paid",
    });

  } catch (err) {
    console.error("Payment status error:", err);
    res.status(500).json({ ok: false, error: "status check failed" });
  }
});
// ----------------------------
// CALLBACK (SUCCESS URL)
// GET /api/mobile/payments/myfatoorah/callback?orderId=...&paymentId=...
// ----------------------------
router.get("/myfatoorah/callback", async (req, res) => {
  console.log("✅ CALLBACK HIT", new Date().toISOString());
  console.log("query =", req.query);

  const orderId = req.query.orderId;
  const paymentId =
    req.query.paymentId || req.query.PaymentId || req.query.Id || req.query.paymentID;

  if (!orderId) return res.status(400).send("Missing orderId");

  try {
    if (!MF_TOKEN) {
      // Cannot verify → deep link fail
      return res.redirect(deepLinkFail(orderId, "SERVER_TOKEN_MISSING"));
    }

    if (!paymentId) {
      // MyFatoorah sometimes hits callback without paymentId if user closed page
      await Order.findByIdAndUpdate(orderId, { "payment.status": "failed" });
      return res.redirect(deepLinkFail(orderId, "MISSING_PAYMENT_ID"));
    }

    const response = await axios.post(
      `${MF_BASE}/v2/GetPaymentStatus`,
      { Key: paymentId, KeyType: "PaymentId" },
      { headers: MF_HEADERS, timeout: 25000 }
    );

    const data = response.data?.Data;
    const invoiceStatus = data?.InvoiceStatus; // Paid | Unpaid | Expired | Failed ...
    const isPaid = invoiceStatus === "Paid";

    await Order.findByIdAndUpdate(orderId, {
      "payment.status": isPaid ? "paid" : "failed",
      "payment.paymentId": String(paymentId),
      "payment.invoiceId": String(data?.InvoiceId || ""),
      "payment.method": "myfatoorah",
    });

    // ✅ THIS IS THE KEY FIX: return to the app via deep link
    if (isPaid) {
      return res.redirect(deepLinkSuccess(orderId));
    } else {
      return res.redirect(deepLinkFail(orderId, `STATUS_${invoiceStatus || "UNKNOWN"}`));
    }
  } catch (err) {
    console.log("❌ CALLBACK verify failed:", err?.response?.status, err?.message);
    console.log("body =", JSON.stringify(err?.response?.data || {}, null, 2));

    await Order.findByIdAndUpdate(orderId, { "payment.status": "failed" });

    return res.redirect(deepLinkFail(orderId, "VERIFY_FAILED"));
  }
});

// ----------------------------
// ERROR (CANCEL / FAIL URL)
// GET /api/mobile/payments/myfatoorah/error?orderId=...
// ----------------------------
router.get("/myfatoorah/error", async (req, res) => {
  console.log("❌ ERROR HIT", new Date().toISOString(), "query =", req.query);

  const orderId = req.query.orderId;

  try {
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, { "payment.status": "failed" });
    }
  } catch (e) {
    console.log("❌ error route update failed:", e?.message);
  }

  // ✅ return to app
  return res.redirect(deepLinkFail(orderId || "", "CANCELLED"));
});

module.exports = router;