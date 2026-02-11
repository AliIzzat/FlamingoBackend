// scripts/seed-test-driver-1.js
require("dotenv").config();
const mongoose = require("mongoose");

const Order = require("../models/Order");
const User = require("../models/User");

const ORDER_COUNT = 10;

// Doha-ish coordinates for map verification
const DOHA_POINTS = [
  { name: "West Bay", lat: 25.323, lng: 51.528 },
  { name: "Al Sadd", lat: 25.285, lng: 51.526 },
  { name: "The Pearl", lat: 25.372, lng: 51.548 },
  { name: "Lusail", lat: 25.420, lng: 51.490 },
  { name: "Old Airport", lat: 25.260, lng: 51.565 },
  { name: "Bin Mahmoud", lat: 25.292, lng: 51.515 },
];

const MENU = [
  { name: "Chicken Shawarma", price: 18, category: "restaurant" },
  { name: "Beef Burger", price: 25, category: "restaurant" },
  { name: "Pizza Margherita", price: 30, category: "restaurant" },
  { name: "Biryani", price: 28, category: "restaurant" },
  { name: "Pasta Alfredo", price: 32, category: "restaurant" },
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

async function connect() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGO_URI (or MONGODB_URI) in .env");
  await mongoose.connect(uri);
}

async function upsertDriver() {
  // Adjust these fields if your User model differs
  const username = "test_driver_1";
  const password = "1234"; // testing only
  const role = "driver";

  let driver = await User.findOne({ username });

  if (!driver) {
    driver = await User.create({
      name: "Test Driver 1",
      username,
      password,
      role,
      phone: "50000001",
    });
    console.log("✅ Created driver:", username, driver._id.toString());
  } else {
    console.log("✅ Driver exists:", username, driver._id.toString());
  }

  return driver;
}

async function seedOrders(driverId) {
  // We will create a mix:
  // - 5 orders: Pending + unassigned (UNPICKED)
  // - 3 orders: Claimed + assigned to test_driver_1
  // - 1 order: PickedUp + assigned
  // - 1 order: Delivered + assigned
  const plannedStatuses = [
    "Pending",
    "Pending",
    "Pending",
    "Pending",
    "Pending",
    "Claimed",
    "Claimed",
    "Claimed",
    "PickedUp",
    "Delivered",
  ];

  const now = Date.now();
  const docs = plannedStatuses.map((status, i) => {
    const customerPoint = pick(DOHA_POINTS);
    const pickupPoint = pick(DOHA_POINTS);
    const item = pick(MENU);
    const qty = randInt(1, 3);

    const subtotal = item.price * qty;
    const deliveryFee = randInt(3, 10);
    const total = subtotal + deliveryFee;

    const createdAt = new Date(now - randInt(10 * 60 * 1000, 3 * 24 * 60 * 60 * 1000));
    const assignedDriverId = status === "Pending" ? null : driverId;

    const claimedAt =
      status === "Claimed" || status === "PickedUp" || status === "Delivered"
        ? new Date(createdAt.getTime() + randInt(2, 30) * 60 * 1000)
        : null;

    const pickedUpAt =
      status === "PickedUp" || status === "Delivered"
        ? new Date((claimedAt || createdAt).getTime() + randInt(5, 30) * 60 * 1000)
        : null;

    const deliveredAt =
      status === "Delivered"
        ? new Date((pickedUpAt || claimedAt || createdAt).getTime() + randInt(10, 60) * 60 * 1000)
        : null;

    return {
      // Tag for easy reset later
      isTestSeed: true,
      testSeedTag: "test_driver_1",

      customer: {
        name: `Seed Customer ${i + 1}`,
        phone: `55${randInt(100000, 999999)}`,
        addressText: `${customerPoint.name}, Doha`,
        location: { lat: customerPoint.lat, lng: customerPoint.lng },
      },

      pickup: {
        addressText: `Test Restaurant - ${pickupPoint.name}`,
        location: { lat: pickupPoint.lat, lng: pickupPoint.lng },
      },

      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          storeId: null,
          category: item.category,
          name_snapshot: item.name,
          price_snapshot: item.price,
          qty,
          image_snapshot: "",
        },
      ],

      totals: { subtotal, deliveryFee, total },

      payment: { method: "cash", status: "paid", invoiceId: "", paymentId: "" },

      delivery: {
        status,
        assignedDriverId,
        claimedAt,
        pickedUpAt,
        deliveredAt,
      },

      dispute: {
        status: "None",
        reason: "",
        notesCustomer: "",
        notesAdmin: "",
        createdAt: null,
        updatedAt: null,
        refund: {
          amount: 0,
          currency: "QAR",
          method: "",
          refundId: "",
          refundedAt: null,
        },
      },

      createdAt,
      updatedAt: new Date(createdAt.getTime() + randInt(1, 120) * 60 * 1000),
    };
  });

  const inserted = await Order.insertMany(docs);
  console.log(`✅ Inserted ${inserted.length} orders for test_driver_1.`);
  console.log("   - 5 Unpicked (Pending + no driver)");
  console.log("   - 3 Claimed (assigned to test_driver_1)");
  console.log("   - 1 PickedUp (assigned to test_driver_1)");
  console.log("   - 1 Delivered (assigned to test_driver_1)");
}

(async () => {
  try {
    await connect();
    const driver = await upsertDriver();
    await seedOrders(driver._id);
    console.log("✅ Done.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  }
})();
