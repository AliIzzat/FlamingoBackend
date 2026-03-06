// routes/api/mobile/payments.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const Order = require("../../../models/Order");

// Adding getPaymentStatus
async function getPaymentStatusFromMF({ invoiceId, paymentId }) {
  if (!MF_TOKEN) throw new Error("MYFATOORAH_TOKEN missing");

  if (!invoiceId && !paymentId) {
    throw new Error("invoiceId or paymentId is required");
  }

  const Key = paymentId ? String(paymentId) : String(invoiceId);
  const KeyType = paymentId ? "PaymentId" : "InvoiceId";

  const r = await axios.post(
    `${MF_BASE}/v2/GetPaymentStatus`,
    { Key, KeyType },
    { headers: mfHeaders(), timeout: 25000, validateStatus: () => true }
  );

  // If MyFatoorah returns HTTP error, still return details
  if (r.status < 200 || r.status >= 300) {
    const msg = r.data?.Message || `MF GetPaymentStatus failed (HTTP ${r.status})`;
    throw new Error(msg);
  }

  const data = r.data?.Data;
  if (!data) {
    const msg = r.data?.Message || "MF response missing Data";
    throw new Error(msg);
  }

  return data; // <- this is MyFatoorah Data (InvoiceStatus, InvoiceTransactions, etc.)
}

// =========================
// ENV (You said Railway uses ONLY MYFATOORAH_TOKEN)
// =========================
const MF_TOKEN = process.env.MYFATOORAH_TOKEN || "";
console.log("🔐 payments.js MYFATOORAH_TOKEN length =", MF_TOKEN.length);

// Base URL (test by default)
const MF_BASE_RAW =
  process.env.MYFATOORAH_API_URL ||
  process.env.MF_API_URL ||
  "https://apitest.myfatoorah.com";

const MF_BASE = String(MF_BASE_RAW).replace(/\/+$/, "").replace(/\/v2$/, "");
console.log("🌐 payments.js MF_BASE =", MF_BASE);

// Deep link scheme (optional; will NOT work reliably on Expo Go)
const APP_SCHEME = process.env.MOBILE_SCHEME || "flamingdelivery";

// Public base URL used in CallBackUrl/ErrorUrl
function getPublicBaseUrl() {
  const appBase = process.env.APP_BASE_URL;
  if (appBase) return String(appBase).replace(/\/+$/, "");

  const pub = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (pub) return `https://${pub}`;

  // local fallback
  return "http://localhost:4000";
}

function deepLinkReturn({ orderId, paymentId, status }) {
  return `${APP_SCHEME}://payment-return?orderId=${encodeURIComponent(
    orderId || ""
  )}&paymentId=${encodeURIComponent(paymentId || "")}&status=${encodeURIComponent(
    status || ""
  )}`;
}

function mfHeaders() {
  return {
    Authorization: `Bearer ${MF_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// =========================
// INITIATE PAYMENT
// POST /api/mobile/payments/myfatoorah/initiate
// =========================
router.post("/myfatoorah/initiate", async (req, res) => {
  console.log("🔥 HIT /myfatoorah/initiate", new Date().toISOString());

  try {
    if (!MF_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "MYFATOORAH_TOKEN missing on server",
        hint: "Set MYFATOORAH_TOKEN in Railway Variables",
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

    // Use ONE return endpoint for success & error
    const CallBackUrl = `${baseUrl}/api/mobile/payments/myfatoorah/return?orderId=${encodeURIComponent(
      orderId
    )}`;
    const ErrorUrl = `${baseUrl}/api/mobile/payments/myfatoorah/return?orderId=${encodeURIComponent(
      orderId
    )}`;

    console.log("✅ MF CallBackUrl =", CallBackUrl);
    console.log("✅ MF ErrorUrl    =", ErrorUrl);

    const payload = {
      PaymentMethodId: methodId,
      InvoiceValue: Number(totalAmount),
      CustomerName: customerName || "Customer",
      DisplayCurrencyIso: "QAR",
      MobileCountryCode: "+974",
      CustomerMobile: customerMobile || "00000000",
      CustomerEmail: customerEmail || "test@example.com",
      CallBackUrl,
      ErrorUrl,
      Language: "en",
    };

    const r = await axios.post(`${MF_BASE}/v2/ExecutePayment`, payload, {
      headers: mfHeaders(),
      timeout: 25000,
      validateStatus: () => true,
    });

    if (r.status < 200 || r.status >= 300) {
      return res.status(502).json({
        ok: false,
        error: `ExecutePayment failed (HTTP ${r.status})`,
        details: r.data,
      });
    }

    const data = r.data?.Data;

    if (!data?.PaymentURL) {
      return res.status(500).json({
        ok: false,
        error: "MyFatoorah did not return PaymentURL",
        details: r.data,
      });
    }

    // Save invoiceId for later verification (important!)
    if (data?.InvoiceId) {
      await Order.findByIdAndUpdate(orderId, {
        "payment.invoiceId": String(data.InvoiceId),
        "payment.method": "myfatoorah",
        "payment.status": "unpaid",
      });
    }

    return res.json({
      ok: true,
      paymentUrl: data.PaymentURL,
      invoiceId: data.InvoiceId,
    });
  } catch (err) {
    console.log("❌ /initiate error:", err?.message);
    return res.status(500).json({
      ok: false,
      error: "Initiate crashed",
      details: err?.message,
    });
  }
});

// =========================
// STATUS CHECK (JSON)
// GET /api/mobile/payments/status?invoiceId=... or ?paymentId=...
// =========================
router.get("/status", async (req, res) => {
  try {
    if (!MF_TOKEN) {
      return res.status(500).json({ ok: false, error: "MYFATOORAH_TOKEN missing" });
    }

    const { invoiceId, paymentId } = req.query || {};
    if (!invoiceId && !paymentId) {
      return res.status(400).json({ ok: false, error: "invoiceId or paymentId required" });
    }

    const Key = paymentId ? String(paymentId) : String(invoiceId);
    const KeyType = paymentId ? "PaymentId" : "InvoiceId";

    const r = await axios.post(
      `${MF_BASE}/v2/GetPaymentStatus`,
      { Key, KeyType },
      { headers: mfHeaders(), timeout: 25000, validateStatus: () => true }
    );

    return res.status(200).json({
      ok: r.status >= 200 && r.status < 300,
      http: r.status,
      Key,
      KeyType,
      status: r.data?.Data?.InvoiceStatus || "UNKNOWN",
      paid: r.data?.Data?.InvoiceStatus === "Paid",
      raw: r.data,
    });
  } catch (err) {
    console.error("Status check failed:", err?.message);
    return res.status(500).json({ ok: false, error: "Status check failed", details: err?.message });
  }
});

// =========================
// RETURN PAGE (HTML)
// GET /api/mobile/payments/myfatoorah/return?orderId=...&paymentId=...
// MyFatoorah redirects here after 3DS
// =========================
router.get("/myfatoorah/return", async (req, res) => {
  const orderId = req.query.orderId || "";
  const paymentId =
    req.query.paymentId || req.query.PaymentId || req.query.Id || req.query.paymentID || "";

  try {
    console.log("✅ RETURN HIT", req.originalUrl);

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    if (!MF_TOKEN) {
      return res
        .status(200)
        .send(renderReturnPage({ title: "Payment completed", status: "UNKNOWN", orderId, paymentId, note: "Server token missing (MYFATOORAH_TOKEN)" }));
    }

    if (!orderId) {
      return res
        .status(200)
        .send(renderReturnPage({ title: "Payment completed", status: "UNKNOWN", orderId: "-", paymentId, note: "Missing orderId in return URL" }));
    }

    // If paymentId is missing, fallback to invoiceId stored in DB
    let key = paymentId ? String(paymentId) : "";
    let keyType = paymentId ? "PaymentId" : "";

    if (!key) {
      const order = await Order.findById(orderId).lean();
      const invoiceId = order?.payment?.invoiceId ? String(order.payment.invoiceId) : "";
      if (!invoiceId) {
        return res
          .status(200)
          .send(renderReturnPage({
            title: "Payment processing…",
            status: "PENDING",
            orderId,
            paymentId: "-",
            note: "No paymentId in return URL and no invoiceId stored for this order.",
          }));
      }
      key = invoiceId;
      keyType = "InvoiceId";
    }

    // Call MyFatoorah GetPaymentStatus
    const r = await axios.post(
      `${MF_BASE}/v2/GetPaymentStatus`,
      { Key: key, KeyType: keyType },
      { headers: mfHeaders(), timeout: 25000, validateStatus: () => true }
    );

    const invoiceStatus = r.data?.Data?.InvoiceStatus || "UNKNOWN";
    const isPaid = invoiceStatus === "Paid";
    const invoiceIdFromMF = r.data?.Data?.InvoiceId ? String(r.data.Data.InvoiceId) : "";

    // Update DB
    await Order.findByIdAndUpdate(orderId, {
      "payment.status": isPaid ? "paid" : "unpaid",
      "payment.paymentId": paymentId ? String(paymentId) : undefined,
      "payment.invoiceId": invoiceIdFromMF || undefined,
      "payment.method": "myfatoorah",
    });

    // Render user-friendly page
    return res.status(200).send(
      renderReturnPage({
        title: isPaid ? "Payment Successful ✅" : invoiceStatus === "Failed" ? "Payment Failed ❌" : "Payment Completed",
        status: invoiceStatus,
        orderId,
        paymentId: paymentId || "-",
        deepLink: deepLinkReturn({ orderId, paymentId: paymentId || "", status: invoiceStatus }),
        note: `Verified via ${keyType}`,
      })
    );
  } catch (err) {
    console.error("RETURN error:", err?.message);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(
      renderReturnPage({
        title: "Payment completed",
        status: "UNKNOWN",
        orderId: orderId || "-",
        paymentId: paymentId || "-",
        note: err?.message || "Return crashed",
      })
    );
  }
});

router.get("/myfatoorah/verify", async (req, res) => {
  try {
    const { orderId } = req.query || {};
    if (!orderId) return res.status(400).json({ ok: false, error: "orderId required" });

    // 1) Load order and get invoiceId/paymentId
    const order = await Order.findById(orderId).lean();
    if (!order) return res.status(404).json({ ok: false, error: "Order not found" });

    const invoiceId = order?.payment?.invoiceId || "";
    const paymentId = order?.payment?.paymentId || "";

    // 2) Call MF GetPaymentStatus
    const data = await getPaymentStatusFromMF({ invoiceId, paymentId });

    const invoiceStatus = data?.InvoiceStatus || "UNKNOWN";
    const isPaid = invoiceStatus === "Paid";

    // 3) Take first transaction (if any)
    const tx = data?.InvoiceTransactions?.[0] || {};

    // 4) Update MongoDB (your block)
    await Order.findByIdAndUpdate(orderId, {
      "payment.status": isPaid ? "paid" : "failed",
      "payment.invoiceId": String(data?.InvoiceId || invoiceId || ""),
      "payment.paymentId": String(tx?.PaymentId || paymentId || ""),

      "payment.provider.trackId": String(tx?.TrackId || ""),
      "payment.provider.referenceId": String(tx?.ReferenceId || ""),
      "payment.provider.transactionId": String(tx?.TransactionId || ""),
      "payment.provider.authorizationId": String(tx?.AuthorizationId || ""),
      "payment.provider.gateway": String(tx?.PaymentGateway || ""),
      "payment.provider.currency": String(tx?.PaidCurrency || tx?.Currency || ""),
      "payment.provider.amount": Number(tx?.TransationValue || 0),

      "payment.provider.invoiceStatus": String(invoiceStatus || ""),
      "payment.provider.transactionStatus": String(tx?.TransactionStatus || ""),
      "payment.provider.verifiedAt": new Date(),

      "payment.provider.card.brand": String(tx?.Card?.Brand || ""),
      "payment.provider.card.issuer": String(tx?.Card?.Issuer || ""),
      "payment.provider.card.issuerCountry": String(tx?.Card?.IssuerCountry || ""),
      "payment.provider.card.fundingMethod": String(tx?.Card?.FundingMethod || ""),
      "payment.provider.card.maskedNumber": String(tx?.CardNumber || ""),
      "payment.provider.card.nameOnCard": String(tx?.Card?.NameOnCard || ""),
    });

    // 5) Respond
    return res.json({
      ok: true,
      orderId,
      invoiceId: String(data?.InvoiceId || ""),
      status: invoiceStatus,
      paid: isPaid,
    });
  } catch (err) {
    console.error("❌ verify failed:", err?.message);
    return res.status(500).json({ ok: false, error: err?.message || "verify failed" });
  }
});

// =========================
// HTML TEMPLATE
// =========================
function renderReturnPage({ title, status, orderId, paymentId, note, deepLink }) {
  const badge =
    status === "Paid" ? "ok" : status === "Failed" ? "bad" : status === "PENDING" ? "mid" : "mid";
  const linkBtn = deepLink
    ? `<a class="btn primary" href="${deepLink}">Return to App</a>`
    : "";

  return `
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;background:#f6f7fb;color:#111}
    .wrap{max-width:560px;margin:0 auto;padding:18px}
    .card{background:#fff;border-radius:18px;padding:18px;border:1px solid #e9e9ef;box-shadow:0 8px 24px rgba(0,0,0,.06)}
    h2{margin:0 0 10px;font-size:22px}
    p{margin:8px 0;line-height:1.45}
    .badge{display:inline-block;padding:6px 10px;border-radius:999px;font-weight:800;font-size:12px}
    .ok{background:#e9f7ef;color:#137333}
    .bad{background:#fdecea;color:#b3261e}
    .mid{background:#fff4e5;color:#7a4d00}
    .btn{display:block;text-align:center;text-decoration:none;font-weight:900;padding:14px 16px;border-radius:14px;margin-top:14px}
    .primary{background:#520582;color:#fff}
    .secondary{background:#eef0f6;color:#111}
    .meta{margin-top:10px;font-size:12px;color:#666;word-break:break-word}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h2>${title}</h2>
      <p><span class="badge ${badge}">Status: ${status}</span></p>
      ${linkBtn}
      <a class="btn secondary" href="/health">Open Server Status</a>
      <div class="meta">
        orderId: ${orderId || "-"}<br/>
        paymentId: ${paymentId || "-"}<br/>
        ${note ? `note: ${note}<br/>` : ""}
      </div>
      <p class="meta">If “Return to App” doesn’t open the app, it means your app scheme isn’t registered on this phone (Expo Go limitation). Use a Dev Build/APK for deep links.</p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = router;