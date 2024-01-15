const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
    try {
        const response = await axios.get('https://check.torproject.org/api/ip');
        const isTor = response.data.IsTor;
        res.json({ isTor });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
