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
  try {
    const paymentId =
      req.query.paymentId || req.query.PaymentId || req.query.paymentID || null;

    const invoiceId =
      req.query.invoiceId || req.query.InvoiceId || null;

    const orderId = req.query.orderId || null;

    // If MyFatoorah didn’t send invoiceId/paymentId, still show page
    let status = "UNKNOWN";
    let paid = false;

    // Prefer PaymentId if available (more reliable)
    const Key = paymentId || invoiceId;
    const KeyType = paymentId ? "PaymentId" : "InvoiceId";

    if (Key) {
      const mfRes = await fetch("https://apitest.myfatoorah.com/v2/GetPaymentStatus", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.MF_TOKEN || process.env.MYFATOORAH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ Key, KeyType }),
      });

      const mfJson = await mfRes.json();
      status = mfJson?.Data?.InvoiceStatus || "UNKNOWN";
      paid = status === "Paid";

      // Optional: update your Order record if you want
      if (orderId) {
        await Order.findByIdAndUpdate(orderId, {
          "payment.status": paid ? "paid" : "unpaid",
          "payment.invoiceId": invoiceId ? String(invoiceId) : undefined,
          "payment.paymentId": paymentId ? String(paymentId) : undefined,
        });
      }
    }

    const title = paid ? "Payment Successful ✅" : (status === "Failed" ? "Payment Failed ❌" : "Payment Pending ⏳");
    const subtitle = paid
      ? "Thank you! You can return to the app."
      : "You can return to the app and try again if needed.";

    // Your deep link schemes (change to YOUR real scheme)
    const APP_DEEPLINK = `flamingdelivery://payment-return?orderId=${encodeURIComponent(orderId || "")}&invoiceId=${encodeURIComponent(invoiceId || "")}&paymentId=${encodeURIComponent(paymentId || "")}&status=${encodeURIComponent(status)}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${title}</title>
          <style>
            body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;background:#f6f7fb;color:#111}
            .wrap{max-width:560px;margin:0 auto;padding:18px}
            .card{background:#fff;border-radius:18px;padding:18px;border:1px solid #e9e9ef;box-shadow:0 8px 24px rgba(0,0,0,.06)}
            h1{margin:0 0 10px;font-size:22px}
            p{margin:8px 0;line-height:1.45}
            .badge{display:inline-block;padding:6px 10px;border-radius:999px;font-weight:700;font-size:12px}
            .ok{background:#e9f7ef;color:#137333}
            .bad{background:#fdecea;color:#b3261e}
            .mid{background:#fff4e5;color:#7a4d00}
            .btn{display:block;text-align:center;text-decoration:none;font-weight:800;padding:14px 16px;border-radius:14px;margin-top:14px}
            .primary{background:#520582;color:#fff}
            .secondary{background:#eef0f6;color:#111}
            .meta{margin-top:10px;font-size:12px;color:#666;word-break:break-word}
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="card">
              <h1>${title}</h1>
              <p>${subtitle}</p>

              <div style="margin-top:10px">
                <span class="badge ${paid ? "ok" : (status === "Failed" ? "bad" : "mid")}">
                  Status: ${status}
                </span>
              </div>

              <a class="btn primary" href="${APP_DEEPLINK}">Return to App</a>

              <a class="btn secondary" href="javascript:history.back()">Go Back</a>

              <div class="meta">
                orderId: ${orderId || "-"}<br/>
                invoiceId: ${invoiceId || "-"}<br/>
                paymentId: ${paymentId || "-"}<br/>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("RETURN error:", err);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`
      <html><body style="font-family:Arial;padding:24px">
        <h2>Payment completed</h2>
        <p>You can return to the app now.</p>
      </body></html>
    `);
  }
});
module.exports = router;