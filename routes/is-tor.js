const express = require('express');
const router = express.Router();
const axios = require('axios');
router.get('/', async (req, res) => {
    try {
        console.log(req.ip, req.socket.remoteAddress, req.connection.remoteAddress, req.headers['x-forwarded-for'])
        const ip = req.ip;
        const response = await axios.get(`https://check.torproject.org/api/ip?ip=${ip}`);
        res.json({
            ...response.data,
            reqIp: ip,
            reqSocketRemoteAddress: req.socket.remoteAddress,
            reqConnectionRemoteAddress: req.connection.remoteAddress,
            reqHeadersXForwardedFor: req.headers['x-forwarded-for']
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;