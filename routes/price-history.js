const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser'); // Assuming you have installed the csv-parser package

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

// Function to load historic data into the database without deleting old data
async function loadHistoricToDb() {
    const now = parseInt(Date.now() / 1000);
    try {
        const [usd, inr] = await Promise.all([
            fetch(`https://query1.finance.yahoo.com/v7/finance/download/BTC-USD?period1=1410912000&period2=${now}&interval=1d&events=history&includeAdjustedClose=true`).then((res) => res.text()),
            fetch(`https://query1.finance.yahoo.com/v7/finance/download/BTC-INR?period1=1410912000&period2=${now}&interval=1d&events=history&includeAdjustedClose=true`).then((res) => res.text())
        ]);

        // If fetch succeeds, process the fetched data
        const usdData = usd.split("\n").slice(1);
        const inrData = inr.split("\n").slice(1);
        const operations = [];

        for (let i = 0; i < usdData.length; i++) {
            const [date, open, high, low, close, adjClose, volume] = usdData[i].split(",");
            const [date2, open2, high2, low2, close2, adjClose2, volume2] = inrData[i].split(",");

            operations.push({
                updateOne: {
                    filter: { date: new Date(date).getTime(), asset: "btc" },
                    update: {
                        $set: {
                            usd: parseFloat(parseFloat(close).toFixed(2)),
                            inr: parseFloat(parseFloat(close2).toFixed(2)),
                        }
                    },
                    upsert: true
                }
            });
        }

        // Perform bulk upsert operations
        await PriceHistory.bulkWrite(operations);
        console.log("Data upserted successfully from API.");
    } catch (fetchError) {
        // If fetch fails, read from the CSV file
        console.error("Failed to fetch data. Falling back to CSV file:", fetchError);
        try {
            const csvData = await readCsvFile();
            const operations = csvData.map((row) => ({
                updateOne: {
                    filter: { date: new Date(row.date).getTime(), asset: "btc" },
                    update: {
                        $set: {
                            usd: parseFloat(row.usd),
                            inr: parseFloat(row.inr),
                        }
                    },
                    upsert: true
                }
            }));

            // Perform bulk upsert operations
            await PriceHistory.bulkWrite(operations);
            console.log("Data upserted successfully from CSV.");
        } catch (csvError) {
            console.error("Error reading CSV file:", csvError);
        }
    }
}

loadHistoricToDb();

// Route to handle price history requests
router.get("/", async (req, res) => {
    console.log('price-history');
    try {
        let { from, to, on, limit = 100, asset = 'btc', currency, sort, dates } = req.query;
        const searchParams = {
            asset
        }
        if (from && to) {
            from = new Date(from).getTime();
            to = new Date(to).getTime();
            if (from > to) {
                const temp = from;
                from = to;
                to = temp;
            }
        }
        if (from) {
            searchParams.date = { $gte: new Date(from).getTime() };
        }
        if (to) {
            searchParams.date = { ...searchParams.date, $lte: new Date(to).getTime() };
        }
        if (dates) {
            const datesArray = dates.split(',');
            searchParams.date = { $in: datesArray.map(date => new Date(date).getTime()) };
        }
        if (on) {
            searchParams.date = { $eq: new Date(on).getTime() };
        }
        if (currency) {
            searchParams[currency] = { $exists: true };
        }
        if (sort) {
            if (['asc', 'desc', 'ascending', 'descending', '1', '-1'].includes(sort))
                sort = { date: sort === 'asc' || sort === 'ascending' || sort === '1' ? 1 : -1 };
            else
                return res.status(400).json({ error: 'Invalid sort. Valid values are asc | desc | ascending | descending | 1 | -1' });

        } else {
            sort = { date: -1 };
        }
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
        res.json(priceHistory);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err });
    }
})

// Cron job to periodically update the price history
cron.schedule('0 */4 * * *', async () => {
    await loadHistoricToDb();
});

module.exports = router;
