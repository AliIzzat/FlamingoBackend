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
    addressText: {
      type: String,
      default: "",
      trim: true,
    },
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
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