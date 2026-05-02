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
// CREATE ORDER
// POST /api/mobile/orders/create
// Splits cart into separate orders per store
// -------------------------

router.post("/create", async (req, res) => {
  const { cartItems = [], customer = {} } = req.body;
  const totalAmount = Number(req.body.totalAmount || req.body.total || 0);
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

const DUPLICATE_WINDOW_MINUTES = 10;
const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000);

const normalizeItems = (items = []) =>
  items
    .map((item) => ({
      productId: String(item.productId || item.id || item._id || ""),
      storeId: String(item.storeId || ""),
      quantity: Number(item.quantity || item.qty || 1),
      price: Number(item.price || item.price_snapshot || 0),
      type: String(item.category || item.type || "product"),
    }))
    .sort((a, b) =>
      `${a.storeId}:${a.productId}:${a.type}`.localeCompare(
        `${b.storeId}:${b.productId}:${b.type}`
      )
    );

const newItemsFingerprint = JSON.stringify(normalizeItems(cartItems));

const recentOrders = await Order.find({
  $or: [
    { "customer.phone": customer.phone },
    { "customerSnapshot.phone": customer.phone },
  ],
  $or: [
    { "customer.addressText": customer.addressText },
    { "customerSnapshot.addressText": customer.addressText },
  ],
  totalAmount: Number(totalAmount),
  createdAt: { $gte: since },
}).lean();

const duplicateOrder = recentOrders.find((order) => {
  const existingItems = order.cartItems || order.items || [];
  const existingItemsFingerprint = JSON.stringify(normalizeItems(existingItems));

  const isActiveOrPaid =
    order.payment?.status === "paid" ||
    order.checkout?.isFinalized === true ||
    ["Pending", "Paid", "Confirmed"].includes(order.status) ||
    order.delivery?.status === "Pending";

  return existingItemsFingerprint === newItemsFingerprint && isActiveOrPaid;
});

if (duplicateOrder) {
  console.log("⛔ Duplicate order blocked:", duplicateOrder._id);

  return res.status(409).json({
    ok: false,
    error: "A similar recent order already exists for this customer and address.",
    existingOrderId: duplicateOrder._id,
  });
}

  // const DUPLICATE_WINDOW_MINUTES = 10;
  //   const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000);

  //   const normalizedItems = cartItems
  //     .map((item) => ({
  //       productId: String(item.productId || item.id || item._id),
  //       quantity: Number(item.quantity || 1),
  //     }))
  //     .sort((a, b) => a.productId.localeCompare(b.productId));

  //   const duplicate = await Order.findOne({
  //     "customer.phone": customer.phone,
  //     "customer.addressText": customer.addressText,
  //     totalAmount: Number(totalAmount),
  //     createdAt: { $gte: since },
  //     status: { $in: ["Pending", "Paid", "Confirmed"] },
  //   }).lean();

  //   if (duplicate) {
  //     const duplicateItems = (duplicate.cartItems || [])
  //       .map((item) => ({
  //         productId: String(item.productId || item.id || item._id),
  //         quantity: Number(item.quantity || 1),
  //       }))
  //       .sort((a, b) => a.productId.localeCompare(b.productId));

  //     const sameItems =
  //       JSON.stringify(normalizedItems) === JSON.stringify(duplicateItems);

  //     if (sameItems) {
  //       console.log("⛔ Duplicate order blocked:", duplicate._id);

  //       return res.status(409).json({
  //         ok: false,
  //         error:
  //           "A similar recent order already exists for this customer and address.",
  //         existingOrderId: duplicate._id,
  //       });
  //     }
  //   }

  

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
            const coords = storeDoc?.location?.coordinates || [];
            const sLng = toNumOrNull(coords[0]);
            const sLat = toNumOrNull(coords[1]);
            console.log("🏪 STORE COORD RAW =", coords);
            console.log("🏪 PARSED STORE LAT/LNG =", { sLat, sLng });
            if (sLat != null && sLng != null) {
              pickupLocation = {
                lat: sLat,
                lng: sLng,
              };
            } else {
              console.log("⚠️ Store exists but has no valid coordinates:", storeIdStr);
            }
            console.log("📍 PICKUP LOCATION TO SAVE =", pickupLocation);

      pickupAddressText = storeDoc.address || storeDoc.addressText || storeDoc.name || "";

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

router.get("/:orderId/tracking", async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (
      !order.customerSnapshot?.location?.lat ||
      !order.customerSnapshot?.location?.lng ||
      !order.pickup?.location?.lat ||
      !order.pickup?.location?.lng
    ) {
      return res.status(400).json({
        success: false,
        message: "Order location data incomplete",
      });
    }


    res.json({
      success: true,
      orderStatus: order.status || "Pending",
      estimatedDeliveryTime: order.estimatedDeliveryTime , //|| 30

      
      customerLocation: {
        lat: order.customerSnapshot?.location?.lat ,  // || 25.397
        lng: order.customerSnapshot?.location?.lng ,  // || 51.424
      },

      storeLocation: {
          lat: order.pickup.location.lat,
          lng: order.pickup.location.lng,
        },
     // storeLocation: {
     //   lat: order.pickup?.location?.lat ,  //|| 25.395
     //   lng: order.pickup?.location?.lng ,  //|| 51.421
    //  },

      driverLocation: order.driverLocation
         ? {
      lat: order.driverLiveLocation.lat,
      lng: order.driverLiveLocation.lng,
        }
       : null,
      

      // driverLocation: {
      //   lat: 25.396,
      //   lng: 51.422,
     // },
    });
  } catch (error) {
    console.error("tracking route error:", error);

    res.status(500).json({
      success: false,
      message: error.message,
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
