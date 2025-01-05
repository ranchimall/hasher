const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Import the PriceHistory model from the external file
const PriceHistory = require('../models/price-history');

function logWithTimestamp(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

// Function to log errors with the current timestamp
function errorWithTimestamp(message, error) {
    console.error(`[${new Date().toISOString()}] ERROR: ${message}`, error);
}


// Function to parse dates in different formats (e.g., 2024-10-2 or 2024-9-3)
function parseDateString(dateStr) {
    const parts = dateStr.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1; // Months are 0-indexed in JavaScript Date
    const day = parseInt(parts[2]);

    return new Date(year, month, day).setHours(0, 0, 0, 0); // Set time to 00:00:00.000
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
        errorWithTimestamp('Error fetching BTC prices from BitPay:', error);
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

        logWithTimestamp('Daily average updated successfully.');
    } catch (err) {
        errorWithTimestamp('Error updating daily average:', err);
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

// Route to handle price history requests
router.get("/", async (req, res) => {
    try {
        let { from, to, on, limit = 100, asset = 'btc', currency, sort, dates } = req.query;
        const searchParams = {
            asset
        };

        // Convert 'from' and 'to' dates to proper format
        if (from && to) {
            from = parseDateString(from);
            to = parseDateString(to);
            if (from > to) {
                const temp = from;
                from = to;
                to = temp;
            }
        }

        if (from) {
            searchParams.date = { $gte: from };
        }
        if (to) {
            searchParams.date = { ...searchParams.date, $lte: to };
        }

        // If the 'dates' parameter is used
        if (dates) {
            const datesArray = dates.split(',').map(date => parseDateString(date.trim()));
            searchParams.date = { $in: datesArray };
        }

        // If the 'on' parameter is used for a single date
        if (on) {
            const onDate = parseDateString(on);
            searchParams.date = { $eq: onDate };
        }

        if (currency) {
            searchParams[currency] = { $exists: true };
        }

        if (sort) {
            if (['asc', 'desc', 'ascending', 'descending', '1', '-1'].includes(sort)) {
                sort = { date: sort === 'asc' || sort === 'ascending' || sort === '1' ? 1 : -1 };
            } else {
                return res.status(400).json({ error: 'Invalid sort. Valid values are asc | desc | ascending | descending | 1 | -1' });
            }
        } else {
            sort = { date: -1 };
        }

        // Formatting the data to exclude certain fields
        const dataFormat = { _id: 0, __v: 0, asset: 0 };
        if (currency === 'inr') {
            dataFormat.usd = 0;
        }
        if (currency === 'usd') {
            dataFormat.inr = 0;
        }

        const priceHistory = await PriceHistory.find(searchParams, dataFormat)
            .sort(sort)
            .limit(limit === 'all' ? 0 : parseInt(limit))
            .lean();

        if (!priceHistory || priceHistory.length === 0) {
            return res.status(404).json({ message: 'No data found' });
        }

        res.json(priceHistory);
    } catch (err) {
        errorWithTimestamp('Error serving data',err);
        res.status(500).json({ error: err });
    }
});

// Cron job to collect prices every 4 hours
cron.schedule('0 */4 * * *', async () => {
    logWithTimestamp('Starting price collection for daily averaging...');
    await collectAndUpdatePrices();
});

module.exports = router;
