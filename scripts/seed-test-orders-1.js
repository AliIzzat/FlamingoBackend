require("dotenv").config();
const mongoose = require("mongoose");

const Order = require("../models/Order");
const Notification = require("../models/Notification");
const Store = require("../models/Store");

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Mongo connected");

    const store = await Store.findOne();
    if (!store) throw new Error("No store found");

    const ordersToCreate = 3;

    for (let i = 1; i <= ordersToCreate; i++) {
      const order = await Order.create({
        customer: {
          name: `Test Customer ${i}`,
          phone: `555000${i}`,
          addressText: "Doha, Qatar",
          location: { lat: 25.2854, lng: 51.5310 },
        },
        pickup: {
          storeId: store._id,
          addressText: store.address || "Test Store",
          location: store.location || {},
        },
        items: [
          {
            productId: new mongoose.Types.ObjectId(),
            storeId: store._id,
            category:"nutrition",
            name_snapshot: "Test Item",
            price_snapshot: 20,
            qty: 2,
          },
        ],
        totals: {
          subtotal: 40,
          deliveryFee: 10,
          total: 50,
        },
        payment: {
          method: "cash",
          status: "paid",
        },
        delivery: {
          status: "Pending",
          assignedDriverId: null,
        },
      });

      // 🔔 Notification: unpicked
      await Notification.create({
        orderId: order._id,
        status: "unpicked",
        message: "New order placed",
      });

      console.log(`🧾 Order created: ${order._id}`);
    }

    console.log("🎉 Test orders seeded successfully");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seed error:", err);
    process.exit(1);
  }
})();
