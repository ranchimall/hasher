const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Import the PriceHistory model from the external file
const PriceHistory = require('../models/price-history');

const CSV_FILE_PATH = '/home/production/deployed/utility-api/btc_price_history_full.csv';

// Function to read CSV file and return data
function readCsvFile() {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(CSV_FILE_PATH)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (err) => reject(err));
    });
}

// Function to fetch BTC prices in USD and INR from BitPay API
async function fetchBtcPrices() {
    try {
        const response = await axios.get('https://bitpay.com/api/rates');
        const rates = response.data;

        // Extract BTC to USD and INR rates
        const btcUsdRate = rates.find(rate => rate.code === 'USD' && rate.name === 'US Dollar').rate;
        const btcInrRate = rates.find(rate => rate.code === 'INR' && rate.name === 'Indian Rupee').rate;

        return { usd: btcUsdRate, inr: btcInrRate };
    } catch (error) {
        console.error('Error fetching BTC prices from BitPay:', error);
        return null;
    }
}

// Function to update daily average in the database
async function updateDailyAverage(newPrice) {
    // Set the date to the start of the day (00:00:00.000)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
        // Fetch the current record for the day
        const existingRecord = await PriceHistory.findOne({ date: today, asset: 'btc' });

        if (existingRecord) {
            // Update the cumulative average
            const updatedUsdAvg = ((existingRecord.usd * existingRecord.count) + newPrice.usd) / (existingRecord.count + 1);
            const updatedInrAvg = ((existingRecord.inr * existingRecord.count) + newPrice.inr) / (existingRecord.count + 1);

            await PriceHistory.updateOne(
                { date: today, asset: 'btc' },
                {
                    $set: {
                        usd: updatedUsdAvg,
                        inr: updatedInrAvg,
                        count: existingRecord.count + 1  // Increment the count
                    }
                }
            );
        } else {
            // If no record exists for today, create a new one
            await PriceHistory.create({
                date: today,
                asset: 'btc',
                usd: newPrice.usd,
                inr: newPrice.inr,
                count: 1  // Initialize count to 1
            });
        }

        console.log('Daily average updated successfully.');
    } catch (err) {
        console.error('Error updating daily average:', err);
    }
}

// Function to collect and update prices
async function collectAndUpdatePrices() {
    const price = await fetchBtcPrices();

    if (price) {
        // Update the cumulative average for the day
        await updateDailyAverage(price);
    }
}

// Cron job to collect prices every 4 hours
cron.schedule('0 */4 * * *', async () => {
    console.log('Starting price collection for daily averaging...');
    await collectAndUpdatePrices();
});

module.exports = router;
