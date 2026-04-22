// models/Customer.js
const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: '',
      trim: true,
    },
    // phone: {
    //   type: String,
    //   required: true,
    //   index: true,
    // },
    addressText: {
      type: String,
      required: true,
    },
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Customer', CustomerSchema);