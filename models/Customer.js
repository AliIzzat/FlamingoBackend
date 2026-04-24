// models/Customer.js
const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    addresses: {
      type: [
        {
          label: { type: String, default: "Home" },
          addressText: { type: String, required: true },
          location: {
            lat: Number,
            lng: Number,
          },
          streetNumber: String,
          route: String,
          zone: String,
          city: String,
          country: String,
          isDefault: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
    streetNumber: { 
      type: String, 
      default: "",
     },
    route: { 
      type: String, 
      default: "",
     },
    zone: { 
      type: String, 
      default: "",
     },
    city: { 
      type: String, 
      default: "",
     },
    country: { 
      type: String, 
      default: "",
     },
    },
  { timestamps: true }
);

module.exports = mongoose.model('Customer', CustomerSchema);