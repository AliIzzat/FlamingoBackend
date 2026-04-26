// routes/api/mobile/orders.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Order = require("../../../models/Order");
// const Notification = require("../../../models/Notification");
const Store = require("../../../models/Store");
const Customer = require("../../../models/Customer");
// -------------------------
// Helpers
// -------------------------
function toNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toObjectIdOrNull(v) {
  if (!v) return null;
  const s = String(v);
  return mongoose.Types.ObjectId.isValid(s)
    ? new mongoose.Types.ObjectId(s)
    : null;
}

function calcSubtotalFromItems(items = []) {
  return items.reduce((sum, x) => {
    const price = Number(x.price_snapshot || 0);
    const qty = Number(x.qty || 1);
    return sum + price * qty;
  }, 0);
}

function normalizeItemsForFingerprint(cartItems = []) {
  return [...cartItems]
    .map((x) => ({
      id: String(x.id || x.productId || x._id || ""),
      storeId: String(x.storeId || ""),
      qty: Number(x.quantity ?? x.qty ?? 1),
      price: Number(x.price ?? x.price_snapshot ?? 0),
      type: String(x.type || x.category || "product"),
    }))
    .sort((a, b) =>
      `${a.storeId}:${a.id}:${a.type}`.localeCompare(
        `${b.storeId}:${b.id}:${b.type}`
      )
    );
}

function fingerprintOrder({ cartItems = [], phone = "" }) {
  return JSON.stringify({
    phone: String(phone || "").trim(),
    items: normalizeItemsForFingerprint(cartItems),
  });
}

//------------------------------------------

// -------------------------
// -------------------------
// CREATE ORDER
// POST /api/mobile/orders/create
// Splits cart into separate orders per store
// -------------------------

router.post("/create", async (req, res) => {
  console.log("📦 ORDER CREATE HIT:", JSON.stringify(req.body, null, 2));

  try {
     console.log("🔥 ORDER CREATE HIT");
    console.log("🔥 FULL BODY =", req.body);
    const { cartItems, customer } = req.body || {};

    //----------------------------------------------
            const snapshotToSave = {
          name: String(customer?.name || "").trim(),
          phone: String(customer?.phone || "").trim(),
          addressText: String(customer?.addressText || "").trim(),
          location: {
            lat: customer?.location?.lat ?? null,
            lng: customer?.location?.lng ?? null,
          },
        };

      console.log("CUSTOMER SNAPSHOT TO SAVE =", snapshotToSave);
    //---------------------------------------------------------  

      console.log("ORDER BODY CUSTOMER =", req.body.customer);
      console.log("CUSTOMER NAME =", req.body.customer?.name);

    if (!customer?.phone || !customer?.addressText) {
      return res.status(400).json({
        ok: false,
        error: "Missing customer fields",
      });
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "cartItems is required",
      });
    }

    // Duplicate recent-order guard
    const newFingerprint = fingerprintOrder({
      cartItems,
      phone: customer.phone,
    });

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const recentOrders = await Order.find({
     "customerSnapshot.phone": String(customer.phone).trim(),
      createdAt: { $gte: tenMinutesAgo },
      }).lean();

      const duplicate = recentOrders.find((o) => {
        const existingFingerprint = JSON.stringify({
          phone: String(o.customerSnapshot?.phone || "").trim(),
          items: [...(o.items || [])]
            .map((it) => ({
              id: String(it.productId || ""),
              storeId: String(it.storeId || ""),
              qty: Number(it.qty || 1),
              price: Number(it.price_snapshot || 0),
              type: String(it.category || "product"),
            }))
            .sort((a, b) =>
              `${a.storeId}:${a.id}:${a.type}`.localeCompare(
                `${b.storeId}:${b.id}:${b.type}`
              )
            ),
        });

        return (
          existingFingerprint === newFingerprint &&
          (
            o.payment?.status === "paid" ||
            o.checkout?.isFinalized === true ||
            o.delivery?.status === "Pending"
          )
        );
      });

    if (duplicate) {
      console.log("⛔ Duplicate order blocked:", duplicate._id);
      return res.status(409).json({
        ok: false,
        error: "A similar recent order already exists",
        existingOrderId: duplicate._id,
      });
    }

    // Customer GPS
    const customerLat = toNumOrNull(customer?.location?.lat);
    const customerLng = toNumOrNull(customer?.location?.lng);

    console.log("👤 customer parsed:", customerLat, customerLng);

    // Normalize items
    const normalizedItems = cartItems.map((x) => {
      const rawId = x.productId || x._id || x.id;

      const productId =
        rawId && mongoose.Types.ObjectId.isValid(String(rawId))
          ? new mongoose.Types.ObjectId(String(rawId))
          : rawId;

      const storeId = toObjectIdOrNull(x.storeId);

      return {
        productId,
        category: x.type || x.category || "restaurant",
        name_snapshot: x.name || x.name_snapshot || "Item",
        price_snapshot: Number(x.price ?? x.price_snapshot ?? 0),
        qty: Number(x.quantity ?? x.qty ?? 1),
        storeId,
        image_snapshot: x.image || x.image_snapshot || "",
      };
    });

    console.log("🧾 normalizedItems =", JSON.stringify(normalizedItems, null, 2));

    // Guard: every item must belong to a store
    const itemsWithoutStore = normalizedItems.filter((it) => !it.storeId);
    if (itemsWithoutStore.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Some cart items are missing storeId",
        badItems: itemsWithoutStore.map((it) => ({
          productId: String(it.productId || ""),
          name: it.name_snapshot,
        })),
      });
    }

    // Group by storeId
    const itemsByStore = new Map();

    for (const item of normalizedItems) {
      const key = String(item.storeId);
      if (!itemsByStore.has(key)) {
        itemsByStore.set(key, []);
      }
      itemsByStore.get(key).push(item);
    }

    console.log("🏪 store groups count =", itemsByStore.size);

    let customerDoc = await Customer.findOne({
     phone: String(customer.phone).trim(),
      });

      if (!customerDoc) {
        customerDoc = await Customer.create({
          name: String(customer.name || "").trim(),
          phone: String(customer.phone).trim(),
          addressText: String(customer.addressText || "").trim(),
          location: {
            lat: customerLat,
            lng: customerLng,
          },
        });
      } else {
        customerDoc.name = String(customer.name || customerDoc.name || "").trim();
        customerDoc.addressText = String(customer.addressText || "").trim();
        customerDoc.location = {
          lat: customerLat,
          lng: customerLng,
        };
        await customerDoc.save();
      }

    console.log("✅ customerDoc:", customerDoc._id);


    const createdOrders = [];

    for (const [storeIdStr, storeItems] of itemsByStore.entries()) {
      const pickupStoreId = new mongoose.Types.ObjectId(storeIdStr);

      let pickupLocation = { lat: null, lng: null };
      let pickupAddressText = "";
      let storeName = "Store";

      const storeDoc = await Store.findById(pickupStoreId).lean();

      if (!storeDoc) {
        console.log("⚠️ Store not found for pickupStoreId =", storeIdStr);
        return res.status(400).json({
          ok: false,
          error: `Store not found for storeId ${storeIdStr}`,
        });
      }

      storeName = storeDoc.name || "Store";

      // GeoJSON format: [lng, lat]
      const sLng = toNumOrNull(storeDoc?.location?.coordinates?.[0]);
      const sLat = toNumOrNull(storeDoc?.location?.coordinates?.[1]);

      if (sLat != null && sLng != null) {
        pickupLocation = { lat: sLat, lng: sLng };
      } else {
        console.log("⚠️ Store exists but has no valid coordinates:", storeIdStr);
      }

      pickupAddressText =
        storeDoc.address || storeDoc.addressText || storeDoc.name || "";

      const subtotal = calcSubtotalFromItems(storeItems);

      const orderDoc = await Order.create({
        customerId: customerDoc._id,

        customerSnapshot: snapshotToSave,

        pickup: {
          storeId: pickupStoreId,
          addressText: pickupAddressText,
          location: pickupLocation,
        },

        items: storeItems,

        totals: {
          subtotal,
        },

        delivery: {
          status: "Pending",
        },

        payment: {
          method: "myfatoorah",
          status: "unpaid",
        },

        checkout: {
          isFinalized: false,
          finalizedAt: null,
        },
      });

      createdOrders.push({
        orderId: orderDoc._id,
        storeId: pickupStoreId,
        storeName,
        subtotal,
        itemCount: storeItems.length,
      });

      console.log(
        `✅ Order created for ${storeName}:`,
        String(orderDoc._id),
        `items=${storeItems.length}`
      );
    }

    return res.json({
      ok: true,
      split: createdOrders.length > 1,
      orderCount: createdOrders.length,
      orderIds: createdOrders.map((o) => o.orderId),
      orders: createdOrders,
    });
  } catch (err) {
    console.log("❌ /orders/create error:", err?.message);
    console.log(err?.stack);

    return res.status(500).json({
      ok: false,
      error: "Server error",
    });
  }
});

router.get("/:orderId", async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      order,
      estimatedDeliveryTime: order.estimatedDeliveryTime ?? null,
    });
  } catch (error) {
    console.error("get order error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post("/driver-location", async (req, res) => {
  try {
    const { orderId, lat, lng } = req.body;

    if (!orderId || lat == null || lng == null) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      {
        $set: {
          driverLiveLocation: {
            lat,
            lng,
            updatedAt: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    console.log("🚚 Driver live location updated:", orderId, lat, lng);

    return res.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("❌ Driver location update error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post("/update-eta", async (req, res) => {
  try {
    const { orderId, etaMinutes } = req.body;

    console.log("⏱ ETA update request:", req.body);

    if (!orderId || etaMinutes == null) {
      return res.status(400).json({
        success: false,
        message: "Missing orderId or etaMinutes",
      });
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      {
        $set: {
          estimatedDeliveryTime: etaMinutes,
        },
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    console.log("⏱ ETA updated:", orderId, etaMinutes);

    res.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("ETA update error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
