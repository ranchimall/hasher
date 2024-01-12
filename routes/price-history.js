const express = require('express');
const router = express.Router();
const cron = require('node-cron');

const PriceHistory = require('../models/price-history');

function loadHistoricToDb() {
    const now = parseInt(Date.now() / 1000);
    Promise.all([
        fetch(`https://query1.finance.yahoo.com/v7/finance/download/BTC-USD?period1=1410912000&period2=${now}&interval=1d&events=history&includeAdjustedClose=true`).then((res) => res.text()),
        fetch(`https://query1.finance.yahoo.com/v7/finance/download/BTC-INR?period1=1410912000&period2=${now}&interval=1d&events=history&includeAdjustedClose=true`).then((res) => res.text()),
    ])
        .then(async ([usd, inr]) => {
            const usdData = usd.split("\n").slice(1);
            const inrData = inr.split("\n").slice(1);
            const priceHistoryData = [];
            for (let i = 0; i < usdData.length; i++) {
                const [date, open, high, low, close, adjClose, volume] = usdData[i].split(",");
                const [date2, open2, high2, low2, close2, adjClose2, volume2] = inrData[i].split(",");
                priceHistoryData.push({
                    date: new Date(date).getTime(),
                    asset: "btc",
                    usd: parseFloat(parseFloat(close).toFixed(2)),
                    inr: parseFloat(parseFloat(close2).toFixed(2)),
                });
            }
            // update many
            await PriceHistory.deleteMany({ asset: 'btc' });
            await PriceHistory.insertMany(priceHistoryData);
        })
        .catch((err) => {
            console.log(err);
        })
}
loadHistoricToDb();

router.get("/", async (req, res) => {
    console.log('price-history');
    try {
        const { from, to, on, limit = 100, asset = 'btc', currency } = req.query;
        const searchParams = {
            asset
        }
        if (from) {
            searchParams.date = { $gte: new Date(from).getTime() };
        }
        if (to) {
            searchParams.date = { ...searchParams.date, $lte: new Date(to).getTime() };
        }
        if (on) {
            searchParams.date = { $eq: new Date(on).getTime() };
        }
        if (currency) {
            searchParams[currency] = { $exists: true };
        }
        const dataFormat = { _id: 0, __v: 0, asset: 0 };
        if (currency === 'inr') {
            dataFormat.usd = 0;
        }
        if (currency === 'usd') {
            dataFormat.inr = 0;
        }
        const priceHistory = await PriceHistory.find(searchParams, dataFormat)
            .sort({ date: -1 })
            .limit(limit === 'all' ? 0 : parseInt(limit));
        res.json(priceHistory);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err });
    }
})

router.post("/", async (req, res) => {
    try {
        const { dates } = req.body;
        if (!dates) {
            return res.status(400).json({ error: 'dates is required' });
        }
        if (!Array.isArray(dates)) {
            return res.status(400).json({ error: 'dates must be an array' });
        }
        const priceHistory = await PriceHistory.find({ date: { $in: dates } }, { _id: 0, __v: 0, asset: 0 });
        res.json(priceHistory);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err });
    }
})

cron.schedule('0 */4 * * *', async () => {
    try {
        // will return a csv file
        const [usd, inr] = await Promise.all([
            fetch("https://query1.finance.yahoo.com/v7/finance/download/BTC-USD").
                then((res) => res.text()),
            fetch("https://query1.finance.yahoo.com/v7/finance/download/BTC-INR").
                then((res) => res.text())
        ]);

        const usdData = usd.split("\n").slice(1);
        const inrData = inr.split("\n").slice(1);
        for (let i = 0; i < usdData.length; i++) {
            const [date, open, high, low, close, adjClose, volume] = usdData[i].split(",");
            const [date2, open2, high2, low2, close2, adjClose2, volume2] = inrData[i].split(",");
            const priceHistoryData = {
                date: new Date(date).getTime(),
                asset: "btc",
                usd: parseFloat(parseFloat(close).toFixed(2)),
                inr: parseFloat(parseFloat(close2).toFixed(2)),
            };
            await PriceHistory.findOneAndUpdate(
                { date: priceHistoryData.date, asset: priceHistoryData.asset },
                priceHistoryData,
                { upsert: true }
            );
        }
    } catch (err) {
        console.log(err);
    }
})

module.exports = router;