// config/db.js
const mongoose = require("mongoose");

async function connectDB() {
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URL ||
    "mongodb://127.0.0.1:27017/flamingosDB";

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
  });

  console.log("🟢 Mongo connected");
}

module.exports = connectDB;
