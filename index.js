require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { createHash } = require('crypto');
const archiver = require('archiver');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON requests
app.use(express.json());

// Set up the allowed domains (replace with your specific domains)
const allowedDomains = process.env.ALLOWED_DOMAINS.split(',');

// Middleware to allow requests only from specified domains
app.use((req, res, next) => {
    const { origin } = req.headers;

    // Check if the requesting origin is in the allowedDomains array
    if (allowedDomains.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    // Other headers for handling preflight requests and allowing credentials if needed
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Continue to the next middleware or route handler
    next();
});

app.use(
    rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 1, // limit each IP to 1 request per windowMs
    })
);

app.get('/', (req, res) => {
    res.send('Hello There!');
})

// hashContent function to hash the content of a file
async function hashContent(content) {
    const hash = createHash('sha256');
    hash.update(content);
    return hash.digest('hex');
}

// API endpoint to start the recursive download and hashing
app.post('/hash', async (req, res) => {
    try {
        console.log('Request:', req.body);
        let { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'Missing URL in the request parameters' });
        }
        if (!Array.isArray(url))
            url = [url];

        const promises = url.map(async (url) => {
            const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
            const fileHash = await hashContent(response.data);
            return { url, fileHash };
        })
        let results = await Promise.all(promises);
        results = results.reduce((acc, { url, fileHash }) => {
            acc[url] = fileHash;
            return acc;
        }, {});
        res.json(results);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Function to download a GitHub repo as a zip file
async function downloadGitHubRepo(owner, repo) {
    if (!owner || !repo) {
        throw new Error('Missing owner or repo');
    }
    const zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/master.zip`;
    const response = await axios.get(zipUrl, { responseType: 'arraybuffer' });
    return response.data;
}

// Endpoint to download and zip GitHub repositories
app.post('/download-repos', async (req, res) => {
    try {
        let { urls } = req.body;

        if (!urls) {
            return res.status(400).json({ error: 'Missing urls in the request parameters' });
        }
        if (!Array.isArray(urls)) {
            urls = [urls];
        }

        const archive = archiver('zip');
        res.attachment('repos.zip');

        // Create an array of promises for each repository download
        const downloadPromises = urls.map(async (url) => {
            const [owner, name] = url.split('/').slice(-2);

            if (!owner || !name) {
                console.error(`Invalid url format: ${url}`);
                return;
            }

            const zipBuffer = await downloadGitHubRepo(owner, name);
            // Add the zip file to the archiver
            archive.append(zipBuffer, { name: `${owner}-${name}.zip` });
        });

        // Wait for all promises to complete
        await Promise.all(downloadPromises);

        // Finalize the zip file
        archive.finalize();

        // Pipe the zip file to the response
        archive.pipe(res);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

// Export the Express API
module.exports = app;
