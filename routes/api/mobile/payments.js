// routes/api/mobile/payments.js
console.log("INSIDE PAYMENT.JS");
const express = require("express");
const router = express.Router();
const axios = require("axios");
const Order = require("../../../models/Order");
const Notification = require("../../../models/Notification");
const { printOrderToStore } = require("../../../services/storePrinter");

// Adding getPaymentStatus
async function getPaymentStatusFromMF({ invoiceId, paymentId }) {
  console.log("INSIDE FUNCTION GETPAYMENTSTATUSFROMMF");
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
const MF_TOKEN = process.env.MYFATOORAH_TOKEN || "";
console.log("🔐 payments.js MYFATOORAH_TOKEN length =", MF_TOKEN.length);

// Base URL (test by default)
const MF_BASE_RAW =
  process.env.MYFATOORAH_API_URL ||
  process.env.MF_API_URL ||
  "https://apitest.myfatoorah.com";

const MF_BASE = String(MF_BASE_RAW).replace(/\/+$/, "").replace(/\/v2$/, "");
//console.log("🌐 payments.js MF_BASE =", MF_BASE);

// Deep link scheme (optional; will NOT work reliably on Expo Go)
const APP_SCHEME = process.env.MOBILE_SCHEME || "flamingdelivery";
console.log("📱 payments.js APP_SCHEME =", APP_SCHEME);

// Public base URL used in CallBackUrl/ErrorUrl
function getPublicBaseUrl() {
  console.log("function getPublicBaseUrl()");
  const appBase = process.env.APP_BASE_URL;
  if (appBase) return String(appBase).replace(/\/+$/, "");

  const pub = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (pub) return `https://${pub}`;

  // local fallback
  return "http://localhost:4000";
}

function deepLinkReturn({ orderId, paymentId, status }) {
    console.log("function deepLinkReturn");
  const scheme = String(APP_SCHEME || "flamingdelivery").trim().replace("://", "");
  return `${scheme}://payment-return?orderId=${encodeURIComponent(
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
  console.log("INSIDE router.post(/myfatoorah/initiate");
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

    //console.log("🌐 baseUrl =", baseUrl);
    console.log("🆔 orderId =", orderId);
    console.log("💰 totalAmount =", totalAmount);
    console.log("💳 paymentMethodId =", methodId);

    const CallBackUrl = `${baseUrl}/api/mobile/payments/myfatoorah/return?orderId=${orderId}`;
    const ErrorUrl = `${baseUrl}/api/mobile/payments/myfatoorah/return?orderId=${orderId}`;

    console.log("✅ MF CallBackUrl =", CallBackUrl);
    console.log("✅ MF ErrorUrl =", ErrorUrl);
   
    const DELIVERY_FEE = 10;
    const subtotal = Number(totalAmount) || 0;
    const finalAmount = subtotal + DELIVERY_FEE;
    console.log("💰 totalAmount =", Number(totalAmount));
    console.log("💰 subtotal =", subtotal);
    console.log("💰 finalAmount =", finalAmount);
    const payload = {
      PaymentMethodId: methodId,
      InvoiceValue: finalAmount,
      CustomerName: customerName || "Customer",
      CurrencyIso: "QAR",
      DisplayCurrencyIso: "QAR",
      MobileCountryCode: "+974",
      CustomerMobile: customerMobile || "00000000",
      CustomerEmail: customerEmail || "test@example.com",
      CallBackUrl,
      ErrorUrl,
      Language: "en",
    };
    console.log("📦 ExecutePayment payload =", JSON.stringify(payload, null, 2));

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
  console.log("router.get("/status")");
  router.post(router.get("/status"));
  try {
    if (!MF_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "MYFATOORAH_TOKEN missing",
      });
    }

    const { invoiceId, paymentId } = req.query || {};
    if (!invoiceId && !paymentId) {
      return res.status(400).json({
        ok: false,
        error: "invoiceId or paymentId required",
      });
    }

    const Key = paymentId ? String(paymentId) : String(invoiceId);
    const KeyType = paymentId ? "PaymentId" : "InvoiceId";

    console.log("🔎 /status HIT");
    console.log("🔎 Key =", Key);
    console.log("🔎 KeyType =", KeyType);

    const r = await axios.post(
      `${MF_BASE}/v2/GetPaymentStatus`,
      { Key, KeyType },
      {
        headers: mfHeaders(),
        timeout: 25000,
        validateStatus: () => true,
      }
    );

    console.log("🔎 MF /status HTTP =", r.status);
    console.log("🔎 MF /status body =", JSON.stringify(r.data, null, 2));

    const data = r.data?.Data || null;
    const invoiceStatus = data?.InvoiceStatus || "UNKNOWN";
    const isPaid = invoiceStatus === "Paid";

    // ✅ DECLARE order BEFORE USING IT
    let order = null;

    if (paymentId) {
      order = await Order.findOne({
        "payment.paymentId": String(paymentId),
      });
    }

    if (!order && invoiceId) {
      order = await Order.findOne({
        "payment.invoiceId": String(invoiceId),
      });
    }

    console.log("🔎 matched orderId =", order ? String(order._id) : null);

    // ✅ USE order ONLY AFTER IT HAS BEEN DECLARED AND LOOKED UP
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

  const freshOrder = await Order.findById(order._id);
  const total = Number(freshOrder?.totals?.total || 0).toFixed(2);
  const storeName = freshOrder?.pickup?.addressText || "Store";

  await Notification.findOneAndUpdate(
    { orderId: freshOrder._id },
    {
      $set: {
        orderId: freshOrder._id,
        message: `🆕 ${storeName} | ${freshOrder.customer.name} (${freshOrder.customer.phone}) | QAR ${total}`,
        status: "unpicked",
        driverId: null,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
    }
  );

  // 🖨️ Print once after successful payment verification
  if (!freshOrder.storePrint?.printed) {
    try {
      console.log("🖨️ Triggering store print for order:", String(freshOrder._id));

      const printResult = await printOrderToStore(freshOrder);

      freshOrder.storePrint = {
        printed: true,
        printedAt: new Date(),
        lastError: "",
      };

      await freshOrder.save();

      console.log("✅ Store ticket printed:", printResult);
    } catch (printErr) {
      console.error("❌ Store print failed:", printErr.message);

      freshOrder.storePrint = {
        printed: false,
        printedAt: null,
        lastError: printErr.message || "Print failed",
      };

      await freshOrder.save();
    }
  } else {
    console.log("ℹ️ Store ticket already printed for order:", String(freshOrder._id));
  }
}

    const updatedOrder = order ? await Order.findById(order._id).lean() : null;

    return res.status(200).json({
      ok: true,
      http: r.status,
      Key,
      KeyType,
      status: invoiceStatus,
      paid: isPaid,
      orderId: updatedOrder?._id || order?._id || null,
      finalized: updatedOrder?.checkout?.isFinalized || false,
      paymentStatusInDb: updatedOrder?.payment?.status || "unpaid",
      raw: r.data,
    });
  } catch (err) {
    console.error("❌ Status check failed");
    console.error("message =", err?.message);
    console.error("stack =", err?.stack);
    console.error("response =", JSON.stringify(err?.response?.data || {}, null, 2));

    return res.status(500).json({
      ok: false,
      error: "Status check failed",
      details: err?.message || "Unknown error",
    });
  }
});
//============================
// RETURN PAGE (HTML)
// GET /api/mobile/payments/myfatoorah/return?orderId=...&paymentId=...
// MyFatoorah redirects here after 3DS
// =========================
router.get("/myfatoorah/return", async (req, res) => {
  console.log("router.get("/myfatoorah/return")");
  router.get("/myfatoorah/return");

  const orderId = req.query.orderId || "";

  const paymentId =
    req.query.paymentId ||
    req.query.PaymentId ||
    req.query.Id ||
    req.query.paymentID ||
    "";

  try {

    console.log("====================================");
    console.log("✅ RETURN HIT");
    //console.log("🌐 Full URL =", req.originalUrl);
    console.log("🌍 Host =", req.headers.host);
    console.log("📦 Query =", req.query);
    console.log("🆔 orderId =", orderId);
    console.log("💳 paymentId =", paymentId);
    console.log("====================================");

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    if (!MF_TOKEN) {
      console.log("❌ MYFATOORAH_TOKEN missing");

      return res.status(200).send(
        renderReturnPage({
          title: "Payment completed",
          status: "UNKNOWN",
          orderId,
          paymentId,
          note: "Server token missing (MYFATOORAH_TOKEN)"
        })
      );
    }

    if (!orderId) {

      console.log("⚠️ orderId missing in return URL");

      return res.status(200).send(
        renderReturnPage({
          title: "Payment completed",
          status: "UNKNOWN",
          orderId: "-",
          paymentId,
          note: "Missing orderId in return URL"
        })
      );
    }

    // If paymentId is missing, fallback to invoiceId stored in DB
    let key = paymentId ? String(paymentId) : "";
    let keyType = paymentId ? "PaymentId" : "";

    if (!key) {

      console.log("⚠️ paymentId missing, falling back to invoiceId");

      const order = await Order.findById(orderId).lean();

      console.log("🔎 Loaded order from DB =", order ? order._id : "NOT FOUND");

      const invoiceId = order?.payment?.invoiceId
        ? String(order.payment.invoiceId)
        : "";

      console.log("📄 invoiceId from DB =", invoiceId);

      if (!invoiceId) {

        console.log("❌ No paymentId and no invoiceId");

        return res.status(200).send(
          renderReturnPage({
            title: "Payment processing…",
            status: "PENDING",
            orderId,
            paymentId: "-",
            note: "No paymentId in return URL and no invoiceId stored for this order."
          })
        );
      }

      key = invoiceId;
      keyType = "InvoiceId";
    }

    console.log("🔑 Using verification key =", key);
    console.log("🔑 KeyType =", keyType);
    // Call MyFatoorah GetPaymentStatus
    const r = await axios.post(
      `${MF_BASE}/v2/GetPaymentStatus`,
      { Key: key, KeyType: keyType },
      { headers: mfHeaders(), timeout: 25000, validateStatus: () => true }
    );

    const invoiceStatus = r.data?.Data?.InvoiceStatus || "UNKNOWN";
    const isPaid = invoiceStatus === "Paid";

    console.log("🔎 invoiceStatus =", invoiceStatus);
    console.log("🔎 isPaid =", isPaid);
    const invoiceIdFromMF = r.data?.Data?.InvoiceId ? String(r.data.Data.InvoiceId) : "";

    // Update DB
    const order = await Order.findByIdAndUpdate(
      orderId,
      {
        "payment.status": isPaid ? "paid" : "unpaid",
        "payment.paymentId": paymentId ? String(paymentId) : "",
        "payment.invoiceId": invoiceIdFromMF || "",
        "payment.method": "myfatoorah",
        "provider.name": "myfatoorah",
        "provider.invoiceStatus": invoiceStatus,
        "provider.verifiedAt": new Date(),
      },
      { new: true }
    );

    // Print to store once, only after successful payment
    if (isPaid && order) {
      if (!order.storePrint?.printed) {
        try {
          const printResult = await printOrderToStore(order);

          order.storePrint = {
            printed: true,
            printedAt: new Date(),
            lastError: "",
          };

          await order.save();
          console.log("✅ Store ticket printed:", printResult);
        } catch (printErr) {
          console.error("❌ Store print failed:", printErr.message);

          order.storePrint = {
            printed: false,
            printedAt: null,
            lastError: printErr.message || "Print failed",
          };

          await order.save();
        }
      } else {
        console.log("ℹ️ Store ticket already printed for order:", orderId);
      }
    }
    // Render user-friendly page
    return res.status(200).send(
      renderReturnPage({
        title: isPaid
          ? "Payment Successful"
          : invoiceStatus === "Failed"
            ? "Payment Failed"
            : "Payment Completed",
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
function renderReturnPage({ title, status, orderId, paymentId, note, deepLink }) {
  console.log("function renderReturnPage");
  const isPaid = status === "Paid";
  const isFailed = status === "Failed";

  const badgeClass = isPaid ? "success" : isFailed ? "danger" : "warning";
  const titleIcon = isPaid ? "✅" : isFailed ? "❌" : "⏳";
  const subtitle = isPaid
    ? ""
    : isFailed
      ? "Your payment could not be completed."
      : "Your payment is being processed.";

  const returnBtn = deepLink
    ? `<a class="btn btn-primary" href="${deepLink}">Return to App</a>`
    : "";

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>Payment Successful</title>

  <style>
    :root{
      --bg1:#fbfcfe;
      --bg2:#f3f5fa;
      --text:#1b1b1f;
      --muted:#7a8190;
      --primary:#520582;
      --primary-dark:#3d0461;
      --success-bg:#eef8f1;
      --success-text:#1c7a45;
      --secondary-bg:#eef1f6;
      --secondary-text:#1f2937;
    }

    *{
      box-sizing:border-box;
      -webkit-tap-highlight-color: transparent;
    }

    html, body{
      margin:0;
      padding:0;
      min-height:100dvh;
    }

    body{
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 100%);
      color: var(--text);
      display:flex;
      align-items:center;
      justify-content:center;
      padding:20px 16px calc(20px + env(safe-area-inset-bottom));
    }

    .screen{
      width:100%;
      max-width:340px;
      text-align:center;
    }

    .title{
      margin:0;
      font-size:14px;
      font-weight:600;
      line-height:1.35;
      letter-spacing:-0.01em;
    }

    .subtitle{
      margin:6px 0 0;
      font-size:11px;
      color:var(--muted);
      line-height:1.5;
    }

    .status{
      display:inline-flex;
      align-items:center;
      gap:6px;
      margin-top:14px;
      padding:6px 10px;
      border-radius:999px;
      background:var(--success-bg);
      color:var(--success-text);
      font-size:11px;
      font-weight:600;
    }

    .actions{
      display:flex;
      flex-direction:column;
      gap:10px;
      margin-top:18px;
    }

    .btn{
      display:block;
      width:100%;
      padding:9px 12px;
      border:none;
      border-radius:12px;
      text-decoration:none;
      text-align:center;
      font-size:11px;
      font-weight:600;
      line-height:1.2;
    }

    .btn-primary{
      background:var(--primary);
      color:#fff;
    }

    .btn-primary:active{
      background:var(--primary-dark);
    }

    .btn-secondary{
      background:var(--secondary-bg);
      color:var(--secondary-text);
    }

    .brand{
      margin-top:14px;
      font-size:10px;
      color:#a0a7b4;
      letter-spacing:.03em;
    }

    @media (min-width: 481px){
      .title{ font-size:15px; }
      .btn{ font-size:12px; }
      .subtitle{ font-size:12px; }
      .status{ font-size:12px; }
    }
  </style>
</head>
<body>
  <main class="screen">
    <h1 class="title">Payment Successful ✅</h1>
    <p class="subtitle">Your payment has been completed successfully.</p>

    <div class="status">
      <span>Status:</span>
      <span>Paid</span>
    </div>

    <div class="actions">
      <a class="btn btn-primary" href="flamingdelivery://payment-return">Return to App</a>
      <a class="btn btn-secondary" href="/">Back to Home</a>
    </div>
  </main>

  <script>
    window.addEventListener("load", function () {
      setTimeout(function () {
        window.scrollTo(0, 1);
      }, 120);
    });
  </script>
</body>
</html>`;
}
module.exports = router;