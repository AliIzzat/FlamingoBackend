const express = require("express");
const router = express.Router();
const Customer = require("../../models/Customer");
const Otp = require("../../models/Otp");

function normalizePhone(phone) {
  return String(phone || "").replace(/\s+/g, "").trim();
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// 1) Send OTP
router.post("/send-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone is required",
      });
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.findOneAndUpdate(
      { phone },
      {
        $set: {
          phone,
          code,
          expiresAt,
        },
      },
      {
        new: true,
        upsert: true,
      }
    );

    console.log(`📱 OTP for ${phone}: ${code}`);

    res.json({
      success: true,
      message: "OTP sent",
      otp: code, // remove this later in production
    });
  } catch (error) {
    console.error("send-otp error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 2) Verify OTP and create customer if needed
router.post("/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const otp = String(req.body.otp || "").trim();

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone and OTP are required",
      });
    }

    const otpDoc = await Otp.findOne({ phone, code: otp });

    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    if (otpDoc.expiresAt < new Date()) {
      await Otp.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    const customer = await Customer.findOneAndUpdate(
      { phone },
      {
        $set: {
          phone,
          isVerified: true,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    await Otp.deleteOne({ _id: otpDoc._id });

    res.json({
      success: true,
      message: "OTP verified",
      customer,
    });
  } catch (error) {
    console.error("verify-otp error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 3) Save/update address for that same customer
// router.post("/save-address", async (req, res) => {
//   try {
//     console.log("🔥 HIT /save-address");
//     console.log("🔥 BODY =", req.body);

//     const {
//       phone,
//       addressText,
//       lat,
//       lng,
//       streetNumber,
//       route,
//       zone,
//       city,
//       country,
//     } = req.body;

//     if (!phone) {
//       return res.status(400).json({
//         success: false,
//         message: "Phone is required",
//       });
//     }

//     if (!addressText || !addressText.trim()) {
//       return res.status(400).json({
//         success: false,
//         message: "Address is required",
//       });
//     }

//     const customer = await Customer.findOneAndUpdate(
//       { phone },
//       {
//         $set: {
//           phone,
//           addressText: addressText.trim(),
//           location: {
//             lat,
//             lng,
//           },

//           // 🔥 NEW DATA
//           streetNumber,
//           route,
//           zone,
//           city,
//           country,
//         },
//       },
//       {
//         new: true,
//         upsert: true,
//         runValidators: true,
//       }
//     );

//     console.log("✅ SAVED =", customer);

//     res.json({
//       success: true,
//       customer,
//     });
//   } catch (error) {
//     console.error("❌ ERROR:", error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// });

router.post("/add-address", async (req, res) => {
  try {
    const {
      phone,
      label,
      addressText,
      lat,
      lng,
      streetNumber,
      route,
      zone,
      city,
      country,
      isDefault,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone is required" });
    }

    if (!addressText || !addressText.trim()) {
      return res.status(400).json({ success: false, message: "Address is required" });
    }

    const newAddress = {
      label: label || "Home",
      addressText: addressText.trim(),
      location: {
        lat: lat ?? null,
        lng: lng ?? null,
      },
      streetNumber: streetNumber || "",
      route: route || "",
      zone: zone || "",
      city: city || "",
      country: country || "",
      isDefault: !!isDefault,
    };

    if (isDefault) {
    await Customer.updateOne(
      { phone },
      {
        $set: {
          addresses: [],
        },
      },
      {
        upsert: true,
      }
    );

      await Customer.updateOne(
        { phone, addresses: { $exists: true, $ne: [] } },
        {
          $set: {
            "addresses.$[].isDefault": false,
          },
        }
      );
    }

    const customer = await Customer.findOne({ phone });

    // if customer exists but no addresses → initialize it
    if (customer && !customer.addresses) {
      customer.addresses = [];
      await customer.save();
    }

    if (isDefault && customer?.addresses?.length) {
      await Customer.updateOne(
        { phone },
        { $set: { "addresses.$[].isDefault": false } }
      );
    }

    const updatedCustomer = await Customer.findOneAndUpdate(
      { phone },
      {
        $push: { addresses: newAddress },
      },
      {
        new: true,
        upsert: true,
      }
    );

module.exports = router;
