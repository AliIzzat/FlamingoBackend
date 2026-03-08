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
  try {
    if (!MF_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "MYFATOORAH_TOKEN missing on server",
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

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        ok: false,
        error: "Order not found",
      });
    }

    // safe guards for old documents
    if (order.checkout?.isFinalized) {
      return res.status(400).json({
        ok: false,
        error: "Order already completed",
      });
    }

    if (order.payment?.status === "paid") {
      return res.status(400).json({
        ok: false,
        error: "Order already paid",
      });
    }

    const baseUrl = getPublicBaseUrl();
    const methodId = Number(paymentMethodId || 2);

    const CallBackUrl = `${baseUrl}/api/mobile/payments/myfatoorah/return?orderId=${encodeURIComponent(orderId)}`;
    const ErrorUrl = `${baseUrl}/api/mobile/payments/myfatoorah/return?orderId=${encodeURIComponent(orderId)}`;

    console.log("✅ MF CallBackUrl =", CallBackUrl);
    console.log("✅ MF ErrorUrl =", ErrorUrl);

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

    console.log("💳 ExecutePayment HTTP =", r.status);
    console.log("💳 ExecutePayment body =", JSON.stringify(r.data, null, 2));

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

    await Order.findByIdAndUpdate(orderId, {
      "payment.invoiceId": String(data?.InvoiceId || ""),
      "payment.method": "myfatoorah",
      "payment.status": "unpaid",
    });

    return res.json({
      ok: true,
      paymentUrl: data.PaymentURL,
      invoiceId: data.InvoiceId,
    });
  } catch (err) {
    console.error("❌ /myfatoorah/initiate crashed:");
    console.error("message =", err?.message);
    console.error("stack =", err?.stack);
    console.error("response =", JSON.stringify(err?.response?.data || {}, null, 2));

    return res.status(500).json({
      ok: false,
      error: "initiate crashed",
      details: err?.message || "Unknown error",
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

    const data = r.data?.Data || null;
    const invoiceStatus = data?.InvoiceStatus || "UNKNOWN";
    const isPaid = invoiceStatus === "Paid";

    // ✅ Find the related order in MongoDB
    let order = null;

    if (paymentId) {
      order = await Order.findOne({
        $or: [
          { "payment.paymentId": String(paymentId) },
          { "payment.provider.transactionId": String(paymentId) },
        ],
      });
    }

    if (!order && invoiceId) {
      order = await Order.findOne({
        "payment.invoiceId": String(invoiceId),
      });
    }

    // ✅ Update order if paid and not yet finalized
    if (order && isPaid && !order.checkout?.isFinalized) {
      await Order.findByIdAndUpdate(order._id, {
        "payment.status": "paid",
        "payment.invoiceId": String(data?.InvoiceId || invoiceId || ""),
        "payment.paymentId": String(
          data?.InvoiceTransactions?.[0]?.PaymentId || paymentId || ""
        ),
        "checkout.isFinalized": true,
        "checkout.finalizedAt": new Date(),
      });
    }

    const updatedOrder = order
    ? await Order.findById(order._id).lean()
    : null;

    return res.status(200).json({
      ok: r.status >= 200 && r.status < 300,
      http: r.status,
      Key,
      KeyType,
      status: invoiceStatus,
      paid: isPaid,
      orderId: updatedOrder?._id || order?._id || null,

      // ✅ values from MongoDB after update
      finalized: updatedOrder?.checkout?.isFinalized || false,
      paymentStatusInDb: updatedOrder?.payment?.status || "unpaid",

      raw: r.data,
    });
  } catch (err) {
    console.error("Status check failed:", err?.message);
    return res.status(500).json({
      ok: false,
      error: "Status check failed",
      details: err?.message,
    });
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
    const order = await Order.findById(orderId);
    if (!order) {
       return res.status(404).json({ ok: false, error: "Order not found" });
    }
    if (order.payment?.status === "paid") {
       return res.status(400).json({
       ok: false,
       error: "This order is already paid",
     });
    }
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
      status: isPaid ? "Paid" : invoiceStatus,
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
function renderReturnPage({ title, status, orderId, paymentId, note }) {
  const color =
    status === "Paid"
      ? "#16a34a"
      : status === "Failed"
      ? "#dc2626"
      : "#f59e0b";

  return `
<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />

<style>

body{
  font-family:system-ui,Arial;
  background:#f4f6fb;
  margin:0;
  padding:20px;
  display:flex;
  justify-content:center;
}

.card{
  max-width:420px;
  width:100%;
  background:white;
  padding:25px;
  border-radius:16px;
  box-shadow:0 10px 30px rgba(0,0,0,0.08);
  text-align:center;
}

.title{
  font-size:22px;
  font-weight:800;
  margin-bottom:10px;
}

.status{
  display:inline-block;
  padding:8px 14px;
  border-radius:20px;
  background:${color}20;
  color:${color};
  font-weight:700;
  margin-bottom:20px;
}

.btn{
  display:block;
  padding:14px;
  margin-top:12px;
  border-radius:12px;
  font-weight:700;
  text-decoration:none;
}

.btn-primary{
  background:#520582;
  color:white;
}

.btn-secondary{
  background:#e5e7eb;
  color:#111;
}

.details{
  margin-top:20px;
  font-size:13px;
  color:#555;
  text-align:left;
  line-height:1.5;
}

.note{
  margin-top:14px;
  font-size:12px;
  color:#777;
}

</style>
</head>

<body>

<div class="card">

<div class="title">${title}</div>

<div class="status">
Status: ${status}
</div>

<a class="btn btn-primary"
href="flamingdelivery://payment-return?orderId=${encodeURIComponent(
    orderId
  )}&paymentId=${encodeURIComponent(paymentId)}&status=${encodeURIComponent(
    status
  )}">
Return to App
</a>

<a class="btn btn-secondary"
<a class="btn" href="/api/mobile/payments/status?paymentId=${encodeURIComponent(paymentId)}">
  View Payment Status
</a>

<div class="details">
<b>orderId:</b> ${orderId}<br/>
<b>paymentId:</b> ${paymentId}<br/>
${note ? `<b>note:</b> ${note}` : ""}
</div>

<div class="note">
If "Return to App" doesn't open the app, your phone browser does not allow deep links
from this page. Simply open the app and press <b>"Check Payment Status"</b>.
</div>

</div>

</body>
</html>
`;
}
module.exports = router;

