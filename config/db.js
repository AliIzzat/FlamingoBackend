// config/db.js
const mongoose = require("mongoose");

async function connectDB() {
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URL ||
    process.env.MONGO_URI;

  if (!uri) {
    throw new Error("Missing MongoDB URI. Set MONGODB_URI in Railway Variables.");
  }

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
  });

  console.log("🟢 Mongo connected");
}

module.exports = connectDB;
