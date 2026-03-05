// routes/api/mobile/payments.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const Order = require("../../../models/Order");
// ----------------------------
// ENV HELPERS
// ----------------------------
// function pickFirst(...vals) {
//   for (const v of vals) {
//     if (typeof v === "string" && v.trim()) return v.trim();
//   }
//   return "";
// }

// ✅ Token (supports all names)
const MF_TOKEN = (process.env.MYFATOORAH_API_KEY || process.env.MYFATOORAH_TOKEN ||  process.env.MF_TOKEN);
console.log("🔐 MF_TOKEN length =", (MF_TOKEN || "").length);

// ✅ Base URL (supports all names)
const MF_BASE_RAW=process.env.MYFATOORAH_API_BASE;
// const MF_BASE_RAW = pickFirst(
//   process.env.MYFATOORAH_API_BASE, // your Railway variable name
//   process.env.MYFATOORAH_API_URL,
//   process.env.MF_API_URL,
//   "https://apitest.myfatoorah.com"
// );

// ✅ Normalize base: remove trailing "/" + remove trailing "/v2"
const MF_BASE = MF_BASE_RAW.replace(/\/+$/, "").replace(/\/v2$/, "");

const MF_HEADERS = {
  Authorization: `Bearer ${token}`,   //MF_TOKEN
  "Content-Type": "application/json",
};

// ✅ Your customer app scheme (must match app.json -> scheme)
const APP_SCHEME = (process.env.MOBILE_SCHEME, "flamingdelivery"); //pickFirst()

// ✅ Public base URL for callback/error endpoints
function getPublicBaseUrl() {
  const appBase = process.env.APP_BASE_URL;      //pickFirst()
  if (appBase) return appBase.replace(/\/+$/, "");

  const pub = process.env.RAILWAY_PUBLIC_DOMAIN;   //pickFirst()
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
  const token = process.env.MYFATOORAH_TOKEN;   // ✅ read at request time

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

    const CallBackUrl = `${baseUrl}/api/mobile/payments/myfatoorah/return?orderId=${encodeURIComponent(orderId)}`;
    const ErrorUrl   = `${baseUrl}/api/mobile/payments/myfatoorah/return?orderId=${encodeURIComponent(orderId)}`;

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
    const { invoiceId, paymentId } = req.query;

    if (!invoiceId && !paymentId) {
      return res.status(400).json({ ok: false, error: "invoiceId or paymentId required" });
    }

    const Key = paymentId || invoiceId;
    const KeyType = paymentId ? "PaymentId" : "InvoiceId";

    const mfRes = await fetch("https://apitest.myfatoorah.com/v2/GetPaymentStatus", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MYFATOORAH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Key, KeyType }),
    });

    const data = await mfRes.json();
    const status = data?.Data?.InvoiceStatus; // Paid / Unpaid / etc.

    return res.json({
      ok: true,
      Key,
      KeyType,
      status,
      paid: status === "Paid",
      raw: data,
    });
  } catch (err) {
    console.error("Status check failed:", err);
    return res.status(500).json({ ok: false, error: "Status check failed" });
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
router.get("/myfatoorah/return", async (req, res) => {
  const orderId = req.query.orderId || "-";
  const paymentId = req.query.paymentId || req.query.PaymentId || req.query.Id || "-";

  try {
    console.log("✅ RETURN HIT originalUrl =", req.originalUrl);
    console.log("✅ RETURN HIT query =", req.query);

    const token = process.env.MF_TOKEN || process.env.MYFATOORAH_TOKEN;
    if (!token) {
      return res
        .status(200)
        .type("html")
        .send(renderReturnPage({ title: "Payment completed", status: "UNKNOWN", orderId, paymentId, note: "Server token missing" }));
    }

    // Prefer PaymentId if available
    const Key = paymentId !== "-" ? String(paymentId) : null;
    const KeyType = Key ? "PaymentId" : null;

    if (!Key) {
      return res
        .status(200)
        .type("html")
        .send(renderReturnPage({ title: "Payment completed", status: "UNKNOWN", orderId, paymentId, note: "Missing paymentId" }));
    }

    const mfRes = await fetch("https://apitest.myfatoorah.com/v2/GetPaymentStatus", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Key, KeyType }),
    });

    const raw = await mfRes.text(); // ✅ read text first
console.log("💳 MF status http =", mfRes.status);
console.log("💳 MF status raw  =", (raw || "").slice(0, 800));

// 1) Empty body case
if (!raw || !raw.trim()) {
  return res
    .status(200)
    .type("html")
    .send(renderReturnPage({
      title: "Payment completed",
      status: "UNKNOWN",
      orderId,
      paymentId,
      note: `MF empty response body (HTTP ${mfRes.status})`,
    }));
}

let mfJson;
try {
  mfJson = JSON.parse(raw);
} catch (e) {
  // 2) Non-JSON case (HTML, text, proxy error, etc.)
  const snippet = raw.replace(/\s+/g, " ").slice(0, 160);
  return res
    .status(200)
    .type("html")
    .send(renderReturnPage({
      title: "Payment completed",
      status: "UNKNOWN",
      orderId,
      paymentId,
      note: `MF non-JSON response (HTTP ${mfRes.status}) :: ${snippet}`,
    }));
}

// 3) JSON error structure case (no Data)
if (!mfJson?.Data) {
  const msg =
    mfJson?.Message ||
    mfJson?.message ||
    mfJson?.ValidationErrors?.[0]?.Error ||
    "MF JSON missing Data";
  return res
    .status(200)
    .type("html")
    .send(renderReturnPage({
      title: "Payment completed",
      status: "UNKNOWN",
      orderId,
      paymentId,
      note: `MF JSON error (HTTP ${mfRes.status}) :: ${msg}`,
    }));
}
    const invoiceStatus = mfJson?.Data?.InvoiceStatus || "UNKNOWN";
    const paid = invoiceStatus === "Paid";

    // Optional: update DB here using orderId if you want

    return res
      .status(200)
      .type("html")
      .send(renderReturnPage({
        title: paid ? "Payment Successful ✅" : invoiceStatus === "Failed" ? "Payment Failed ❌" : "Payment Pending ⏳",
        status: invoiceStatus,
        orderId,
        paymentId,
      }));
  } catch (err) {
    console.error("RETURN error:", err);
    return res
      .status(200)
      .type("html")
      .send(renderReturnPage({ title: "Payment completed", status: "UNKNOWN", orderId, paymentId, note: err?.message }));
  }
});

function renderReturnPage({ title, status, orderId, paymentId, note }) {
  return `
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body{font-family:Arial;padding:20px;background:#f6f7fb}
    .card{background:#fff;border:1px solid #eee;border-radius:14px;padding:16px}
    .btn{display:block;text-align:center;margin-top:12px;padding:12px;border-radius:10px;background:#520582;color:#fff;text-decoration:none;font-weight:800}
    .muted{color:#666;font-size:12px;word-break:break-word;margin-top:10px}
  </style>
</head>
<body>
  <div class="card">
    <h2>${title}</h2>
    <p>Status: <b>${status}</b></p>
    <a class="btn" href="flamingdelivery://payment-return?orderId=${encodeURIComponent(orderId)}&paymentId=${encodeURIComponent(paymentId)}&status=${encodeURIComponent(status)}">Return to App</a>
    <div class="muted">
      orderId: ${orderId}<br/>
      paymentId: ${paymentId}<br/>
      ${note ? `note: ${note}<br/>` : ""}
    </div>
  </div>
</body>
</html>`;
}
module.exports = router;