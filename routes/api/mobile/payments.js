// routes/api/mobile/payments.js
const express = require("express");
const axios = require("axios");
const router = express.Router();

const Order = require("../../../models/Order");
const Notification = require("../../../models/Notification");
const { printOrderToStore } = require("../../../services/storePrinter");

const MF_TOKEN = process.env.MYFATOORAH_TOKEN || process.env.MF_TOKEN || "";
const MF_BASE_RAW =
  process.env.MYFATOORAH_API_URL ||
  process.env.MF_API_URL ||
  "https://apitest.myfatoorah.com";

const MF_BASE = String(MF_BASE_RAW).replace(/\/+$/, "").replace(/\/v2$/, "");
const APP_SCHEME = String(process.env.MOBILE_SCHEME || "flamingdelivery")
  .trim()
  .replace("://", "");

const DELIVERY_FEE = 10;

function mfHeaders() {
  return {
    Authorization: `Bearer ${MF_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function ensureToken() {
  if (!MF_TOKEN) {
    throw new Error("MYFATOORAH_TOKEN missing");
  }
}

function getPublicBaseUrl() {
  const appBase = process.env.APP_BASE_URL;
  if (appBase) return String(appBase).replace(/\/+$/, "");

  const pub = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (pub) return `https://${pub}`;

  return "http://localhost:4000";
}

function deepLinkReturn({ orderId, paymentId, status }) {
  return `${APP_SCHEME}://payment-return?orderId=${encodeURIComponent(
    orderId || ""
  )}&paymentId=${encodeURIComponent(paymentId || "")}&status=${encodeURIComponent(
    status || ""
  )}`;
}

function getStatusKey({ invoiceId, paymentId }) {
  if (paymentId) {
    return {
      key: String(paymentId),
      keyType: "PaymentId",
    };
  }

  if (invoiceId) {
    return {
      key: String(invoiceId),
      keyType: "InvoiceId",
    };
  }

  throw new Error("invoiceId or paymentId is required");
}

async function getPaymentStatusFromMF({ invoiceId, paymentId }) {
  ensureToken();

  const { key, keyType } = getStatusKey({ invoiceId, paymentId });

  const r = await axios.post(
    `${MF_BASE}/v2/GetPaymentStatus`,
    { Key: key, KeyType: keyType },
    {
      headers: mfHeaders(),
      timeout: 25000,
      validateStatus: () => true,
    }
  );

  if (r.status < 200 || r.status >= 300) {
    const msg = r.data?.Message || `MF GetPaymentStatus failed (HTTP ${r.status})`;
    throw new Error(msg);
  }

  const data = r.data?.Data;
  if (!data) {
    throw new Error(r.data?.Message || "MF response missing Data");
  }

  return {
    httpStatus: r.status,
    raw: r.data,
    data,
    key,
    keyType,
    invoiceStatus: data?.InvoiceStatus || "UNKNOWN",
    isPaid: data?.InvoiceStatus === "Paid",
    invoiceId: data?.InvoiceId ? String(data.InvoiceId) : "",
    tx: data?.InvoiceTransactions?.[0] || {},
  };
}

async function saveOrderTotals(order, totalAmount) {
  const subtotal = Number(totalAmount) || 0;
  const total = subtotal + DELIVERY_FEE;

  order.totals = order.totals || {};
  order.totals.subtotal = subtotal;
  order.totals.deliveryFee = DELIVERY_FEE;
  order.totals.total = total;

  await order.save();

  return { subtotal, total };
}

async function updateOrderPaymentFields(orderId, verification, fallback = {}) {
  const paymentId =
    verification?.tx?.PaymentId || fallback.paymentId || "";

  const invoiceId =
    verification?.invoiceId || fallback.invoiceId || "";

  const update = {
    "payment.status": verification.isPaid ? "paid" : "unpaid",
    "payment.paymentId": String(paymentId || ""),
    "payment.invoiceId": String(invoiceId || ""),
    "payment.method": "myfatoorah",

    "provider.name": "myfatoorah",
    "provider.invoiceStatus": verification.invoiceStatus,
    "provider.verifiedAt": new Date(),

    "payment.provider.trackId": String(verification?.tx?.TrackId || ""),
    "payment.provider.referenceId": String(verification?.tx?.ReferenceId || ""),
    "payment.provider.transactionId": String(verification?.tx?.TransactionId || ""),
    "payment.provider.authorizationId": String(verification?.tx?.AuthorizationId || ""),
    "payment.provider.gateway": String(verification?.tx?.PaymentGateway || ""),
    "payment.provider.currency": String(
      verification?.tx?.PaidCurrency || verification?.tx?.Currency || ""
    ),
    "payment.provider.amount": Number(verification?.tx?.TransationValue || 0),
    "payment.provider.invoiceStatus": String(verification.invoiceStatus || ""),
    "payment.provider.transactionStatus": String(
      verification?.tx?.TransactionStatus || ""
    ),
    "payment.provider.verifiedAt": new Date(),
    "payment.provider.card.brand": String(verification?.tx?.Card?.Brand || ""),
    "payment.provider.card.issuer": String(verification?.tx?.Card?.Issuer || ""),
    "payment.provider.card.issuerCountry": String(
      verification?.tx?.Card?.IssuerCountry || ""
    ),
    "payment.provider.card.fundingMethod": String(
      verification?.tx?.Card?.FundingMethod || ""
    ),
    "payment.provider.card.maskedNumber": String(
      verification?.tx?.CardNumber || ""
    ),
    "payment.provider.card.nameOnCard": String(
      verification?.tx?.Card?.NameOnCard || ""
    ),
  };

  if (verification.isPaid) {
    update["checkout.isFinalized"] = true;
    update["checkout.finalizedAt"] = new Date();
  }

  return Order.findByIdAndUpdate(orderId, update, { new: true });
}

async function createOrUpdateNotification(order) {
  const total = Number(order?.totals?.total || 0).toFixed(2);
  const storeName = order?.pickup?.addressText || "Store";

  await Notification.findOneAndUpdate(
    { orderId: order._id },
    {
      $set: {
        orderId: order._id,
        message: `🆕 ${storeName} | ${order.customer.name} (${order.customer.phone}) | QAR ${total}`,
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
}

async function printToStoreOnce(order) {
  if (!order || order.storePrint?.printed) return order;

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

  return order;
}

async function finalizePaidOrder(orderId, verification, fallback = {}) {
  let order = await updateOrderPaymentFields(orderId, verification, fallback);

  if (!order) return null;
  if (!verification.isPaid) return order;

  await createOrUpdateNotification(order);

  if (!order.checkout?.isFinalized) {
    order.checkout = order.checkout || {};
    order.checkout.isFinalized = true;
    order.checkout.finalizedAt = new Date();
    await order.save();
  }

  order = await printToStoreOnce(order);
  return order;
}

async function findOrderByPaymentRef({ invoiceId, paymentId }) {
  if (paymentId) {
    const byPaymentId = await Order.findOne({
      "payment.paymentId": String(paymentId),
    });
    if (byPaymentId) return byPaymentId;
  }

  if (invoiceId) {
    const byInvoiceId = await Order.findOne({
      "payment.invoiceId": String(invoiceId),
    });
    if (byInvoiceId) return byInvoiceId;
  }

  return null;
}

function renderReturnPage({ title, status, deepLink }) {
  const normalizedStatus = String(status || "UNKNOWN");
  const isPaid = normalizedStatus === "Paid";
  const isFailed = normalizedStatus === "Failed";

  const badgeClass = isPaid ? "success" : isFailed ? "danger" : "warning";
  const titleIcon = isPaid ? "✅" : isFailed ? "❌" : "⏳";

  const returnBtn = deepLink
    ? `<a class="btn btn-primary" href="${deepLink}">Return to App</a>`
    : "";

  return `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>

<style>
  body {
    margin:0;
    font-family: system-ui, -apple-system, sans-serif;
    background:#f4f6fb;
    display:flex;
    justify-content:center;
    align-items:center;
    height:100vh;
  }

  .card {
    width:90%;
    max-width:320px;
    background:#fff;
    border-radius:18px;
    padding:20px 16px;
    text-align:center;
    box-shadow:0 8px 20px rgba(0,0,0,0.06);
  }

  .title {
    font-size:16px; /* 👈 smaller */
    font-weight:700;
    margin:0;
  }

  .status {
    margin-top:16px;
    display:inline-block;
    padding:6px 12px;
    border-radius:999px;
    font-size:12px;
    font-weight:700;
  }

  .status.success {
    background:#e8f6ee;
    color:#1f7a4c;
  }

  .status.danger {
    background:#fdecec;
    color:#a61d24;
  }

  .status.warning {
    background:#fff4e5;
    color:#996600;
  }

  .actions {
    margin-top:18px;
    display:flex;
    flex-direction:column;
    gap:8px;
  }

  .btn {
    padding:8px 10px; /* 👈 smaller buttons */
    border-radius:10px;
    font-size:12px;
    font-weight:600;
    text-decoration:none;
  }

  .btn-primary {
    background:#520582;
    color:#fff;
  }

  .btn-secondary {
    background:#eef1f6;
    color:#333;
  }

</style>
</head>

<body>
  <div class="card">
    <h1 class="title">${title} ${titleIcon}</h1>

    <div class="status ${badgeClass}">
      Status: ${normalizedStatus}
    </div>

    <div class="actions">
      ${returnBtn}
      <a class="btn btn-secondary" href="/">Home</a>
    </div>
  </div>
</body>
</html>
`;
}
// =========================
// INITIATE PAYMENT
// POST /api/mobile/payments/myfatoorah/initiate
// =========================
router.post("/myfatoorah/initiate", async (req, res) => {
  try {
    ensureToken();

    const {
      orderId,
      orderIds,
      customerName,
      customerEmail,
      customerMobile,
      paymentMethodId,
    } = req.body || {};

    // Support both old single-order and new multi-order mode
    const normalizedOrderIds = Array.isArray(orderIds) && orderIds.length
      ? orderIds
      : orderId
        ? [orderId]
        : [];

    if (!normalizedOrderIds.length) {
      return res.status(400).json({
        ok: false,
        error: "orderIds (or orderId) is required",
      });
    }

    const uniqueOrderIds = [...new Set(normalizedOrderIds.map(String))];

    const orders = await Order.find({
      _id: { $in: uniqueOrderIds },
    });

    if (orders.length !== uniqueOrderIds.length) {
      return res.status(404).json({
        ok: false,
        error: "One or more orders were not found",
      });
    }

    let combinedOrdersTotal = 0;

    for (const order of orders) {
      if (order.checkout?.isFinalized) {
        return res.status(400).json({
          ok: false,
          error: `Order already completed: ${order._id}`,
        });
      }

      if (order.payment?.status === "paid") {
        return res.status(400).json({
          ok: false,
          error: `Order already paid: ${order._id}`,
        });
      }

      combinedOrdersTotal += Number(order?.totals?.total || 0);
    }

    if (combinedOrdersTotal <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Combined order total must be greater than 0",
      });
    }

    const methodId = Number(paymentMethodId || 2);
    const baseUrl = getPublicBaseUrl();

    // Pass all orderIds in callback
    const orderIdsParam = encodeURIComponent(uniqueOrderIds.join(","));
    const returnUrl = `${baseUrl}/api/mobile/payments/myfatoorah/return?orderIds=${orderIdsParam}`;

    const payload = {
      PaymentMethodId: methodId,
      InvoiceValue: combinedOrdersTotal,
      CustomerName: customerName || "Customer",
      CurrencyIso: "QAR",
      DisplayCurrencyIso: "QAR",
      MobileCountryCode: "+974",
      CustomerMobile: customerMobile || "00000000",
      CustomerEmail: customerEmail || "test@example.com",
      CallBackUrl: returnUrl,
      ErrorUrl: returnUrl,
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

    await Order.updateMany(
      { _id: { $in: uniqueOrderIds } },
      {
        $set: {
          "payment.invoiceId": String(data?.InvoiceId || ""),
          "payment.method": "myfatoorah",
          "payment.status": "unpaid",
        },
      }
    );

    return res.json({
      ok: true,
      paymentUrl: data.PaymentURL,
      invoiceId: data.InvoiceId,
      orderIds: uniqueOrderIds,
      totalAmount: combinedOrdersTotal,
    });
  } catch (err) {
    console.error("❌ /myfatoorah/initiate crashed:", err?.message);

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
    ensureToken();

    const { invoiceId, paymentId } = req.query || {};
    if (!invoiceId && !paymentId) {
      return res.status(400).json({
        ok: false,
        error: "invoiceId or paymentId required",
      });
    }

    const verification = await getPaymentStatusFromMF({ invoiceId, paymentId });

    let order = await findOrderByPaymentRef({ invoiceId, paymentId });

    if (order && verification.isPaid && !order.checkout?.isFinalized) {
      order = await finalizePaidOrder(order._id, verification, { invoiceId, paymentId });
    } else if (order) {
      order = await updateOrderPaymentFields(order._id, verification, {
        invoiceId,
        paymentId,
      });
    }

    return res.status(200).json({
      ok: true,
      http: verification.httpStatus,
      key: verification.key,
      keyType: verification.keyType,
      status: verification.invoiceStatus,
      paid: verification.isPaid,
      orderId: order?._id || null,
      finalized: order?.checkout?.isFinalized || false,
      paymentStatusInDb: order?.payment?.status || "unpaid",
      raw: verification.raw,
    });
  } catch (err) {
    console.error("❌ Status check failed:", err?.message);

    return res.status(500).json({
      ok: false,
      error: "Status check failed",
      details: err?.message || "Unknown error",
    });
  }
});

// =========================
// RETURN PAGE (HTML)
// GET /api/mobile/payments/myfatoorah/return?orderId=...&paymentId=...
// =========================
router.get("/myfatoorah/return", async (req, res) => {
  const singleOrderId = req.query.orderId || "";
  const orderIdsParam = req.query.orderIds || "";

  const paymentId =
    req.query.paymentId ||
    req.query.PaymentId ||
    req.query.Id ||
    req.query.paymentID ||
    "";

  const orderIds = orderIdsParam
    ? String(orderIdsParam)
        .split(",")
        .map((x) => String(x).trim())
        .filter(Boolean)
    : singleOrderId
      ? [String(singleOrderId).trim()]
      : [];

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  try {
    ensureToken();

    if (!orderIds.length) {
      return res.status(200).send(
        renderReturnPage({
          title: "Payment completed",
          status: "UNKNOWN",
          deepLink: deepLinkReturn({
            orderId: "",
            paymentId: paymentId || "",
            status: "UNKNOWN",
          }),
        })
      );
    }

    let invoiceId = "";

    if (!paymentId) {
      const firstOrder = await Order.findById(orderIds[0]).lean();
      invoiceId = firstOrder?.payment?.invoiceId
        ? String(firstOrder.payment.invoiceId)
        : "";
    }

    if (!paymentId && !invoiceId) {
      return res.status(200).send(
        renderReturnPage({
          title: "Payment Processing",
          status: "PENDING",
          deepLink: deepLinkReturn({
            orderId: orderIds[0] || "",
            paymentId: "",
            status: "PENDING",
          }),
        })
      );
    }

    const verification = await getPaymentStatusFromMF({ invoiceId, paymentId });

    for (const id of orderIds) {
      await finalizePaidOrder(id, verification, { invoiceId, paymentId });
    }

    return res.status(200).send(
      renderReturnPage({
        title: verification.isPaid
          ? "Payment Successful"
          : verification.invoiceStatus === "Failed"
            ? "Payment Failed"
            : "Payment Completed",
        status: verification.invoiceStatus,
        deepLink: deepLinkReturn({
          orderId: orderIds[0] || "",
          paymentId: String(verification?.tx?.PaymentId || paymentId || ""),
          status: verification.invoiceStatus,
        }),
      })
    );
  } catch (err) {
    console.error("RETURN error:", err?.message);

    return res.status(200).send(
      renderReturnPage({
        title: "Payment completed",
        status: "UNKNOWN",
        deepLink: deepLinkReturn({
          orderId: orderIds[0] || "",
          paymentId: paymentId || "",
          status: "UNKNOWN",
        }),
      })
    );
  }
});

module.exports = router;