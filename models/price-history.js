const mongoose = require('mongoose');
// scheme to store price history
const Schema = new mongoose.Schema({
    date: {
        type: Date,
        required: true,
        unique: true
    },
    asset: {
        type: String,
        required: true
    },
    usd: {
        type: Number,
        required: true
    },
    inr: {
        type: Number,
        required: true
    },
    count: {
        type: Number,  // New field to track the number of updates for the day
        default: 1
    }
});

module.exports = mongoose.model('PriceHistory', Schema);
