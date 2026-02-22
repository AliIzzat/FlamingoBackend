const express = require("express");
const router = express.Router();
const axios = require("axios");
const Order = require("../../../models/Order");

router.post("/myfatoorah/initiate", async (req, res) => {
  try {
    const { 
      orderId, 
      totalAmount, 
      customerName, 
      customerEmail, 
      customerMobile,
      PaymentMethodId 
    } = req.body;
    if (!orderId || !totalAmount) {
      return res.status(400).json({ ok: false, error: "orderId and totalAmount are required" });
    }
    const methodId = Number(req.body.paymentMethodId || 2);
    const baseUrl = process.env.APP_BASE_URL || "http://localhost:4000";

    const CallBackUrl = `${baseUrl}/api/mobile/payments/myfatoorah/callback?orderId=${encodeURIComponent(orderId)}`;
    const ErrorUrl = `${baseUrl}/api/mobile/payments/myfatoorah/error?orderId=${encodeURIComponent(orderId)}`;

    const payload = {
      PaymentMethodId:2,
      InvoiceValue: Number(totalAmount),
      CustomerName: customerName || "Customer",
      DisplayCurrencyIso: "KWD",
      MobileCountryCode: "+975",
      CustomerMobile: customerMobile || "00000000",
      CustomerEmail: customerEmail || "test@example.com",
      CallBackUrl,
      ErrorUrl,
      Language: "en",
    };

    const r = await axios.post("https://apitest.myfatoorah.com/v2/ExecutePayment", payload, {
      headers: {
        Authorization: `Bearer ${process.env.MF_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    const data = r.data?.Data;

    if (data?.InvoiceId) {
      await Order.findByIdAndUpdate(orderId, {
        "payment.invoiceId": String(data.InvoiceId),
      });
    }
    return res.json({ ok: true, paymentUrl: data?.PaymentURL, invoiceId: data?.InvoiceId });
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
      "https://apitest.myfatoorah.com/v2/GetPaymentStatus",
      { Key: paymentId, KeyType: "PaymentId" },
      {
        headers: {
          Authorization: `Bearer ${process.env.MF_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = response.data?.Data;

    if (data?.InvoiceStatus === "Paid") {
      await Order.findByIdAndUpdate(orderId, {
        "payment.status": "paid",
        "payment.paymentId": String(paymentId),
        "payment.invoiceId": String(data?.InvoiceId || ""),
      });
      // return res.send("✅ Payment successful. Return to the app.");
      // ✅ Payment success → open the app via deep link
      return res.redirect(
        `flamingdelivery://payment-success?orderId=${encodeURIComponent(orderId)}`
        );
    }

    await Order.findByIdAndUpdate(orderId, {
      "payment.status": "failed",
      "payment.paymentId": String(paymentId),
      "payment.invoiceId": String(data?.InvoiceId || ""),
    });

    return res.send("❌ Payment not completed.");
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
    return res.send("❌ Payment failed or cancelled.");
  } catch (e) {
    return res.status(500).send("Error handler failed.");
  }
});

module.exports = router;