const mongoose = require('mongoose');

let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri || !(uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://'))) {
    console.error('❌ Invalid or missing MONGODB_URI:', uri);
    throw new Error('MONGODB_URI is missing or malformed');
  }

  try {
    await mongoose.connect(uri); // ✅ Clean modern version
    isConnected = true;
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    throw err;
  }
};

module.exports = connectDB;
