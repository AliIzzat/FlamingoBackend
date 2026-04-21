// models/Customer.js
const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: "",
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    addressText: {
      type: String,
      default: "",
      trim: true,
    },
    streetNumber: {
      type: String,
      default: "",
      trim: true,
    },
    zone: {
      type: String,
      default: "",
      trim: true,
    },
    building: {
      type: String,
      default: "",
      trim: true,
    },
    floor: {
      type: String,
      default: "",
      trim: true,
    },
    aptNo: {
      type: String,
      default: "",
      trim: true,
    },
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Customer', CustomerSchema);