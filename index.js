require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Set up the allowed domains (replace with your specific domains)
// const allowedDomains = process.env.ALLOWED_DOMAINS.split(',');
const app = express();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Middleware to parse JSON requests
app.use(express.json());
// Middleware to enable CORS
// pass the cors options to the cors middleware to enable CORS for the allowed domains
// const corsOptions = {
//     origin: allowedDomains,
//     optionsSuccessStatus: 200, // Some legacy browsers (IE11, various SmartTVs) choke on 204
// }
app.use(cors());

app.use(
    rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 30, // limit each IP request per windowMs
    })
);

// connect to MongoDB
mongoose.connect(`mongodb://${HOST}/price-history`);
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
    console.log('Connected to MongoDB');
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, './index.min.html'));
})
const hash = require('./routes/hash')
app.use("/hash", hash);
const priceHistory = require('./routes/price-history')
app.use("/price-history", priceHistory);
const isTor = require('./routes/is-tor')
app.use("/is-tor", isTor);

// Start the server
app.listen(PORT, HOST, () => {
    console.log(`Server is running at http://${HOST}:${PORT}`);
});

// Export the Express API
module.exports = app;
