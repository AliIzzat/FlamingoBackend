// routes/api/mobile/payments.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const Order = require("../../../models/Order");

const MF_BASE = "https://apitest.myfatoorah.com"; // test endpoint

router.post("/myfatoorah/initiate", async (req, res) => {
  try {
    const {
      orderId,
      totalAmount,
      customerName,
      customerEmail,
      customerMobile,
      paymentMethodId, // ✅ use this (camelCase)
    } = req.body;

    if (!orderId || !totalAmount) {
      return res
        .status(400)
        .json({ ok: false, error: "orderId and totalAmount are required" });
    }

    // ✅ Payment method dynamic (default VISA/MASTER=2 if available)
    const methodId = Number(paymentMethodId || 2);

    // ✅ For local testing this is ok. For production must be public (Railway URL)
    const baseUrl = process.env.APP_BASE_URL || "http://localhost:4000";

    const CallBackUrl = `${baseUrl}/api/mobile/payments/myfatoorah/callback?orderId=${encodeURIComponent(
      orderId
    )}`;
    const ErrorUrl = `${baseUrl}/api/mobile/payments/myfatoorah/error?orderId=${encodeURIComponent(
      orderId
    )}`;

    const payload = {
      PaymentMethodId: methodId, // ✅ IMPORTANT: use dynamic methodId
      InvoiceValue: Number(totalAmount),
      CustomerName: customerName || "Customer",

      // ✅ Use Kuwait test settings (since you said you’ll stay KWT for now)
      DisplayCurrencyIso: "KWD",
      MobileCountryCode: "+965", // ✅ Kuwait country code
      CustomerMobile: customerMobile || "00000000",
      CustomerEmail: customerEmail || "test@example.com",

      CallBackUrl,
      ErrorUrl,
      Language: "en",
    };

    console.log("🔑 MF_TOKEN exists?", !!process.env.MF_TOKEN);
    console.log("💳 Initiate payload:", { ...payload, CustomerEmail: payload.CustomerEmail });

    const r = await axios.post(`${MF_BASE}/v2/ExecutePayment`, payload, {
      headers: {
        Authorization: `Bearer ${process.env.MF_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    // ✅ MyFatoorah returns IsSuccess + Data
    if (!r.data?.IsSuccess) {
      return res.status(400).json({
        ok: false,
        error: "MyFatoorah rejected request",
        details: r.data,
      });
    }

    const data = r.data?.Data;

    // ✅ store invoiceId on order immediately (nice for tracking)
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
    const details = err?.response?.data || { message: err.message };
    console.error("❌ initiate error:", details);
    return res.status(500).json({ ok: false, error: "initiate failed", details });
  }
});

router.get("/myfatoorah/callback", async (req, res) => {
  try {
    const orderId = req.query.orderId;
    const paymentId = req.query.paymentId || req.query.PaymentId || req.query.Id;

    if (!paymentId) return res.status(400).send("Missing paymentId");
    if (!orderId) return res.status(400).send("Missing orderId");

    const response = await axios.post(
      `${MF_BASE}/v2/GetPaymentStatus`,
      { Key: paymentId, KeyType: "PaymentId" },
      {
        headers: {
          Authorization: `Bearer ${process.env.MF_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = response.data?.Data;
    console.log("✅ Payment status:", data?.InvoiceStatus, "InvoiceId:", data?.InvoiceId);

    const isPaid = data?.InvoiceStatus === "Paid";

    // ✅ Update order using YOUR schema paths
    await Order.findByIdAndUpdate(orderId, {
      "payment.status": isPaid ? "paid" : "failed",
      "payment.paymentId": String(paymentId),
      "payment.invoiceId": String(data?.InvoiceId || ""),
      ...(isPaid ? { "delivery.status": "Pending" } : {}),
    });

    // ✅ Return user to app (deep link). Add fallback HTML for Expo/Android browser.
    const deepLink = isPaid
      ? `flamingdelivery://payment-success?orderId=${encodeURIComponent(orderId)}`
      : `flamingdelivery://payment-failed?orderId=${encodeURIComponent(orderId)}`;

    return res.send(`
      <html>
        <body style="font-family: Arial; padding: 24px;">
          <h3>${isPaid ? "✅ Payment Successful" : "❌ Payment Failed"}</h3>
          <p>Tap below to return to the app.</p>
          <a href="${deepLink}" style="font-size:20px;">Return to App</a>
          <script>
            window.location.href = "${deepLink}";
          </script>
        </body>
      </html>
    `);
  } catch (e) {
    console.error("❌ callback error:", e?.response?.data || e.message);
    return res.status(500).send("Payment verification failed.");
  }
});

router.get("/myfatoorah/error", async (req, res) => {
  try {
    const orderId = req.query.orderId;

    if (orderId) {
      await Order.findByIdAndUpdate(orderId, { "payment.status": "failed" });
    }

    const deepLink = `flamingdelivery://payment-failed?orderId=${encodeURIComponent(
      orderId || ""
    )}`;

    return res.send(`
      <html>
        <body style="font-family: Arial; padding: 24px;">
          <h3>❌ Payment Cancelled / Failed</h3>
          <p>Tap below to return to the app.</p>
          <a href="${deepLink}" style="font-size:20px;">Return to App</a>
          <script>
            window.location.href = "${deepLink}";
          </script>
        </body>
      </html>
    `);
  } catch (e) {
    return res.status(500).send("Error handler failed.");
  }
});

module.exports = router;








// const express = require("express");
// const router = express.Router();
// const axios = require("axios");
// const Order = require("../../../models/Order");

// router.post("/myfatoorah/initiate", async (req, res) => {
//   try {
//     const { 
//       orderId, 
//       totalAmount, 
//       customerName, 
//       customerEmail, 
//       customerMobile,
//       PaymentMethodId 
//     } = req.body;
//     if (!orderId || !totalAmount) {
//       return res.status(400).json({ ok: false, error: "orderId and totalAmount are required" });
//     }
//     const methodId = Number(req.body.paymentMethodId || 2);
//     const baseUrl = process.env.APP_BASE_URL || "http://localhost:4000";

//     const CallBackUrl = `${baseUrl}/api/mobile/payments/myfatoorah/callback?orderId=${encodeURIComponent(orderId)}`;
//     const ErrorUrl = `${baseUrl}/api/mobile/payments/myfatoorah/error?orderId=${encodeURIComponent(orderId)}`;

//     const payload = {
//       PaymentMethodId:2,
//       InvoiceValue: Number(totalAmount),
//       CustomerName: customerName || "Customer",
//       DisplayCurrencyIso: "KWD",
//       MobileCountryCode: "+975",
//       CustomerMobile: customerMobile || "00000000",
//       CustomerEmail: customerEmail || "test@example.com",
//       CallBackUrl,
//       ErrorUrl,
//       Language: "en",
//     };

//     const r = await axios.post("https://apitest.myfatoorah.com/v2/ExecutePayment", payload, {
//       headers: {
//         Authorization: `Bearer ${process.env.MF_TOKEN}`,
//         "Content-Type": "application/json",
//       },
//     });

//     const data = r.data?.Data;

//     if (data?.InvoiceId) {
//       await Order.findByIdAndUpdate(orderId, {
//         "payment.invoiceId": String(data.InvoiceId),
//       });
//     }
//     return res.json({ ok: true, paymentUrl: data?.PaymentURL, invoiceId: data?.InvoiceId });
//   } catch (err) {
//     const details = err?.response?.data || { message: err.message };
//     console.error("❌ initiate error:", details);
//     return res.status(500).json({ ok: false, error: "initiate failed", details });
//   }
// });

// router.get("/myfatoorah/callback", async (req, res) => {
//   try {
//     const orderId = req.query.orderId;
//     const paymentId = req.query.paymentId || req.query.PaymentId || req.query.Id;

//     if (!paymentId) return res.status(400).send("Missing paymentId");
//     if (!orderId) return res.status(400).send("Missing orderId");

//     const response = await axios.post(
//       "https://apitest.myfatoorah.com/v2/GetPaymentStatus",
//       { Key: paymentId, KeyType: "PaymentId" },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.MF_TOKEN}`,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     const data = response.data?.Data;

//     if (data?.InvoiceStatus === "Paid") {
//       await Order.findByIdAndUpdate(orderId, {
//         "payment.status": "paid",
//         "payment.paymentId": String(paymentId),
//         "payment.invoiceId": String(data?.InvoiceId || ""),
//       });
//    // ✅ Payment success → open the app via deep link
//       return res.redirect(
//         `flamingdelivery://payment-success?orderId=${encodeURIComponent(orderId)}`
//         );
//     }

//     await Order.findByIdAndUpdate(orderId, {
//       "payment.status": "failed",
//       "payment.paymentId": String(paymentId),
//       "payment.invoiceId": String(data?.InvoiceId || ""),
//     });

//     return res.send("❌ Payment not completed.");
//   } catch (e) {
//     console.error("❌ callback error:", e?.response?.data || e.message);
//     return res.status(500).send("Payment verification failed.");
//   }
// });

// router.get("/myfatoorah/error", async (req, res) => {
//   try {
//     const orderId = req.query.orderId;
//     if (orderId) {
//       await Order.findByIdAndUpdate(orderId, { "payment.status": "failed" });
//     }
//     return res.send("❌ Payment failed or cancelled.");
//   } catch (e) {
//     return res.status(500).send("Error handler failed.");
//   }
// });

// module.exports = router;