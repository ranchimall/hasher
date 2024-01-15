const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const response = await axios.get(`https://check.torproject.org/cgi-bin/TorBulkExitList.py?ip=${ip}`);
        const isTor = response.data.includes(ip);
        res.json({ isTor, ip });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
