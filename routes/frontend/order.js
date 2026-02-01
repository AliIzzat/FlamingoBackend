// routes/frontend/order.js
const express = require('express');
const router = express.Router();
const Order = require('../../models/Order'); 
const Store = require("../../models/Store");
const mongoose = require("mongoose");
const Notification = require("../../models/Notification");

const MF_API_URL = process.env.MF_API_URL || 'https://apitest.myfatoorah.com';
const MF_TOKEN = process.env.MF_TOKEN;
const MF_PAYMENT_METHOD_ID = Number(process.env.MF_PAYMENT_METHOD_ID || 2); 
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://192.168.1.26:4000';
const { DELIVERY_FEE } = require("../../config/pricing");

// Helper to avoid NaN
function getSafeNumber(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}
// ---------- HTML helper for success / error pages ----------
function renderPaymentPage({ status, orderId, paymentId, appBaseUrl, debugJson }) {
  const isSuccess = status === 'success';
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Payment ${isSuccess ? 'Successful' : 'Failed'}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(180deg, #c78eff, #d0dfff);
      padding: 16px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: #ffffff;
      border-radius: 24px;
      padding: 24px 20px 16px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.25);
    }
    .status-icon {
      width: 72px;
      height: 72px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      font-size: 40px;
      color: #ffffff;
    }
    .status-success { background: #22c55e; }
    .status-failed { background: #ef4444; }
    h1 {
      text-align: center;
      font-size: 22px;
      margin-bottom: 4px;
      font-weight: 700;
      color: #111827;
    }
    p.subtitle {
      text-align: center;
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 20px;
    }
    .info-box {
      background: #f9fafb;
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 13px;
      color: #111827;
      margin-bottom: 20px;
    }
    .info-row span.label {
      font-weight: 600;
    }
    .buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-bottom: 6px;
    }
    .btn {
      flex: 1;
      border-radius: 999px;
      padding: 10px 0;
      font-size: 14px;
      font-weight: 600;
      border: none;
      cursor: pointer;
    }
    .btn-primary {
      background: #4f46e5;
      color: #ffffff;
    }
    .btn-secondary {
      background: #ffffff;
      color: #111827;
      border: 1px solid #e5e7eb;
    }
    .debug-toggle {
      font-size: 12px;
      color: #6b7280;
      cursor: pointer;
      margin-top: 6px;
    }
    .debug-content {
      display: none;
      margin-top: 8px;
      background: #0f172a;
      color: #e5e7eb;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 11px;
      max-height: 160px;
      overflow: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="status-icon ${isSuccess ? 'status-success' : 'status-failed'}">
      ${isSuccess ? '✔' : '✖'}
    </div>
    <h1>${isSuccess ? 'Payment Successful' : 'Payment Failed'}</h1>
    <p class="subtitle">
      ${isSuccess ? 'Thank you, your payment was received.' : 'Something went wrong while processing your payment.'}
    </p>
    <div class="info-box">
      <div class="info-row">
        <span class="label">Order ID:</span> ${orderId || '-'}
      </div>
      <div class="info-row">
        <span class="label">Payment ID:</span> ${paymentId || '-'}
      </div>
    </div>
    <div class="buttons">
      <!-- Close button: try to close tab / webview; if not possible, just go back -->
      <button class="btn btn-primary" onclick="handleClose()">Close</button>
      <!-- Home button: send to your REAL backend home route -->
      <button class="btn btn-secondary" onclick="goHome()">Go to Home</button>
    </div>
    <div class="debug-toggle" onclick="toggleDebug()">
      ▶ Debug info from MyFatoorah (GetPaymentStatus)
    </div>
    <pre id="debugBox" class="debug-content">${debugJson || ''}</pre>
  </div>
  <script>
    function handleClose() {
      // Always go to your backend home page
      window.location.href = 'flamingdelivery://exit-app';
    }
    function goHome() {
      // Same as Close: force navigation to your home
      window.location.href = 'flamingdelivery://home';
    }
    function toggleDebug() {
      var box = document.getElementById('debugBox');
      box.style.display = box.style.display === 'block' ? 'none' : 'block';
    }
  </script>
</body>
</html>
`;
}
/* -----------------------------
   POST /order/mobile-checkout
------------------------------*/
router.post("/mobile-checkout", async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      customerMobile,
      city,
      street,
      building,
      floor,
      zone,
      addressNote,
      latitude,
      longitude,
      aptNo,
      cartItems = [],
    } = req.body;

    const normalizedItems = (Array.isArray(cartItems) ? cartItems : []).map((it) => ({
      productId: it?.productId || it?.mealId || it?._id || null,
      storeId: it?.storeId || it?.restaurantId || null,
      category: it?.category || "restaurant", // default if not sent
      name_snapshot: String(it?.name || "Item"),
      price_snapshot: getSafeNumber(it?.price, 0),
      qty: getSafeNumber(it?.quantity, 1),
      image_snapshot: String(it?.image || it?.image_snapshot || ""),
    }));
    // 2) Validate items
    if (!normalizedItems.length || normalizedItems.some((x) => !x.productId)) {
      return res.status(400).json({
        success: false,
        message: "Cart is empty or contains invalid items (missing productId/mealId).",
      });
    }
    /* ✅ INSERT THIS BLOCK HERE */
  const storeIds = [
   ...new Set(
    normalizedItems
      .map((i) => String(i.storeId || "").trim())
      .filter(Boolean)
      ),
    ];

if (storeIds.length > 1) {
  return res.status(400).json({
    success: false,
    message: "You can only place an order from one store at a time.",
  });
}
/* ✅ END INSERT */
    // 3) Compute totals
    const subtotal = normalizedItems.reduce(
      (sum, it) => sum + it.qty * it.price_snapshot,
      0
    );
    // add here temp
    if (normalizedItems.some((x) => !x.storeId)) {
     return res.status(400).json({ success: false, message: "Each item must have a storeId." });
    }
    if (!Number.isFinite(subtotal) || subtotal <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice amount.",
      });
    }
    // You can compute deliveryFee however you want; for now keep 0
        const deliveryFee = DELIVERY_FEE; // 10 QAR
        const total = subtotal + deliveryFee;
    // 4) Build customer snapshot
    const fullAddress =
      addressNote && String(addressNote).trim().length > 0
        ? String(addressNote).trim()
        : `${city || ""} ${street || ""} ${building || ""} ${zone || ""}`.trim();

    const latNum = getSafeNumber(latitude, null);
    const lngNum = getSafeNumber(longitude, null);

    const customer = {
      name: (customerName && String(customerName).trim()) || "Mobile Customer",
      phone: (customerMobile && String(customerMobile).trim()) || "50000000",
      addressText: fullAddress || "Qatar",
      location: {
        lat: Number.isFinite(latNum) ? latNum : null,
        lng: Number.isFinite(lngNum) ? lngNum : null,
      },
    };

// 4) Pickup snapshot from first storeId (Store.location.coordinates = [lng, lat])
//const firstStoreId = normalizedItems?.[0]?.storeId || null;
const rawStoreId = normalizedItems?.[0]?.storeId || null;
const firstStoreId = (rawStoreId && mongoose.Types.ObjectId.isValid(rawStoreId)) ? rawStoreId : null;
let pickup = {
  storeId: firstStoreId,
  addressText: "",
  location: { lat: null, lng: null },
};

if (firstStoreId) {
  const store = await Store.findById(firstStoreId).lean();
  if (store) {
    pickup.addressText = store.address || "";
    const coords = store.location?.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      pickup.location.lng = coords[0]; // lng
      pickup.location.lat = coords[1]; // lat
    }
  }
}
    // 6) Validate MyFatoorah config
    if (!MF_TOKEN) {
      return res.status(500).json({
        success: false,
        message: "Payment gateway not configured (MF_TOKEN missing).",
      });
    }
    // 7) Create order (matches your OrderSchema)
    let orderId = null;
    const order = await Order.create({
      customer,
      pickup, // ✅ remove if you did NOT add pickup to OrderSchema
      items: normalizedItems,
      totals: { subtotal, deliveryFee, total },
      payment: {
        method: "myfatoorah",
        status: "unpaid",
        invoiceId: "",
        paymentId: "",
      },
      delivery: {
        status: "Pending",
        assignedDriverId: null,
        claimedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
      },
    });

   // ✅ Create/Upsert notification for admin (unpicked)
      const now = new Date();
      await Notification.findOneAndUpdate(
    { orderId: order._id },
     {
        $setOnInsert: {
        orderId: order._id,
        status: "unpicked",
        message: "New order placed",
        createdAt: new Date(),
       },
     },
   { upsert: true, new: true }
  );

    orderId = order._id.toString();
    const successUrl = `${APP_BASE_URL}/order/mobile-payment-success?orderId=${encodeURIComponent(orderId)}`;
    const errorUrl = `${APP_BASE_URL}/order/mobile-payment-error?orderId=${encodeURIComponent(orderId)}`;
    // 9) Build ExecutePayment request
    const executeBody = {
      PaymentMethodId: MF_PAYMENT_METHOD_ID,
      CustomerName: customer.name,
      CustomerMobile: customer.phone,
      DisplayCurrencyIso: "KWD",
      InvoiceValue: Number(total.toFixed(3)),
      CallBackUrl: successUrl,
      ErrorUrl: errorUrl,
      CustomerReference: orderId,
      UserDefinedField: orderId,
      InvoiceItems: normalizedItems.map((it) => ({
        ItemName: it.name_snapshot,
        Quantity: it.qty,
        UnitPrice: it.price_snapshot,
      })),
    };
    if (customerEmail && String(customerEmail).includes("@")) {
      executeBody.CustomerEmail = String(customerEmail).trim();
    }

    // 10) Call MyFatoorah
    const mfResp = await fetch(`${MF_API_URL}/v2/ExecutePayment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MF_TOKEN}`,
      },
      body: JSON.stringify(executeBody),
    });
    const rawText = await mfResp.text();
    let mfData = null;
    try {
      mfData = JSON.parse(rawText);
    } catch {
      // fall through
    }

    if (!mfData || !mfData.IsSuccess) {
      return res.status(500).json({
        success: false,
        message: "MyFatoorah ExecutePayment failed.",
        gatewayMessage: mfData?.ValidationErrors
          ? JSON.stringify(mfData.ValidationErrors)
          : mfData?.Message || rawText || "Unknown error",
      });
    }
    const paymentUrl = mfData?.Data?.PaymentURL;
    const invoiceId = mfData?.Data?.InvoiceId;
    if (!paymentUrl) {
      return res.status(500).json({
        success: false,
        message: "No payment URL returned from MyFatoorah.",
      });
    }
    // 11) Save invoiceId into Order.payment.invoiceId (schema-correct)
    await Order.findByIdAndUpdate(orderId, {
      $set: {
        "payment.invoiceId": invoiceId ? String(invoiceId) : "",
        "payment.status": "unpaid",
      },
    });
    return res.json({
      success: true,
      paymentUrl,
      invoiceId,
      orderId,
    });
  } catch (err) {
    console.error("❌ mobile-checkout unexpected error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during mobile checkout.",
      error: err.message,
    });
  }
});

/*-----------------------------
   GET /order/mobile-payment-success - MyFatoorah often redirects with paymentId in query
------------------------------*/
router.get("/mobile-payment-success", async (req, res) => {
  try {
    const orderId = req.query.orderId || "";
    const paymentId = req.query.paymentId || ""; // often present
    const invoiceId = req.query.Id || ""; // sometimes present
    // Mark as paid if orderId is valid
    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      await Order.findByIdAndUpdate(orderId, {
        $set: {
          "payment.status": "paid",
          "payment.paymentId": paymentId ? String(paymentId) : "",
          // keep invoiceId if provided
          ...(invoiceId ? { "payment.invoiceId": String(invoiceId) } : {}),
        },
      });
    }
    return res.send(
      renderPaymentPage({
        status: "success",
        orderId,
        paymentId,
        appBaseUrl: APP_BASE_URL,
        debugJson: "",
      })
    );
  } catch (err) {
    console.error("❌ mobile-payment-success error:", err);
    return res.status(500).send("Error rendering payment success page");
  }
});
/* -----------------------------
   GET /order/mobile-payment-error- we still call GetPaymentStatus to decide paid/failed
------------------------------*/
router.get("/mobile-payment-error", async (req, res) => {
  const { orderId, paymentId, Id } = req.query; // Id can be InvoiceId
  console.log("❌ ERROR callback (raw query):", { orderId, paymentId, Id });
  let mfStatusData = null;
  try {
    if (MF_TOKEN) {
      const statusPayload = {
        Key: paymentId || Id,
        KeyType: paymentId ? "PaymentId" : "InvoiceId",
      };
      const statusRes = await fetch(`${MF_API_URL}/v2/GetPaymentStatus`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MF_TOKEN}`,
        },
        body: JSON.stringify(statusPayload),
      });
      const statusText = await statusRes.text();
      try {
        mfStatusData = JSON.parse(statusText);
      } catch (e) {
        console.error("❌ Failed to parse GetPaymentStatus JSON:", e.message);
      }
    }
  } catch (e) {
    console.error("❌ Error calling GetPaymentStatus:", e);
  }
  const invoiceStatus = String(
    mfStatusData?.Data?.InvoiceStatus ||
      mfStatusData?.Data?.InvoiceStatusEn ||""
  );
  const isPaid =
    mfStatusData?.IsSuccess === true ||
    invoiceStatus.toLowerCase().includes("paid");
  // Update Order.payment.status based on actual outcome
  try {
    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      await Order.findByIdAndUpdate(orderId, {
        $set: {
          "payment.status": isPaid ? "paid" : "failed",
          "payment.paymentId": paymentId ? String(paymentId) : "",
          ...(Id ? { "payment.invoiceId": String(Id) } : {}),
        },
      });
    }
  } catch (e) {
    console.error("❌ Error updating order payment status:", e);
  }
  return res.send(
    renderPaymentPage({
      status: isPaid ? "success" : "error",
      orderId: orderId || "",
      paymentId: paymentId || "",
      appBaseUrl: APP_BASE_URL,
      debugJson: mfStatusData ? JSON.stringify(mfStatusData, null, 2) : "",
    })
  );
});
// ✅ MyFatoorah success callback
router.get('/payment/success', (req, res) => {
  // Here you can verify payment status, update DB, etc.
  res.send('Payment successful');
});
// ✅ MyFatoorah error callback
router.get('/payment/error', (req, res) => {
  // Here you can log error / show message
  res.send('Payment failed or cancelled');
});
router.get("/confirm", (req, res) => {
  res.json({
    ok: true,
    route: "/order/confirm",
    query: req.query,
  });
});
module.exports = router;
