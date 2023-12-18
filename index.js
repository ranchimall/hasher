require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createHash } = require('crypto');
const rateLimit = require('express-rate-limit');
const { parse: parseUrl, URL } = require('url');
const { parse: parseHtml } = require('node-html-parser');

// Set up the allowed domains (replace with your specific domains)
const allowedDomains = process.env.ALLOWED_DOMAINS.split(',');
const app = express();

// pass the cors options to the cors middleware to enable CORS for the allowed domains
// const corsOptions = {
//     origin: allowedDomains,
//     optionsSuccessStatus: 200, // Some legacy browsers (IE11, various SmartTVs) choke on 204
// }
app.use(cors());
const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';

// Middleware to parse JSON requests
app.use(express.json());
// Middleware to enable CORS


app.use(
    rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 10, // limit each IP request per windowMs
    })
);

app.get('/', (req, res) => {
    res.send('Hello There!');
})
function addProtocolToUrl(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    return url;
}

function parseUrlWithoutHashAndQuery(fullUrl) {
    fullUrl = addProtocolToUrl(fullUrl);
    const parsedUrl = new URL(fullUrl);

    // Set the hash and search/query to empty strings
    parsedUrl.hash = '';
    parsedUrl.search = '';

    // Reconstruct the URL without hash and query
    const urlWithoutHashAndQuery = parsedUrl.toString();

    return urlWithoutHashAndQuery;
}
// hashContent function to hash the content of a file
async function hashContent(content) {
    const hash = createHash('sha256');
    hash.update(content);
    return hash.digest('hex');
}

// Recursive function to fetch and hash content, including linked resources
async function fetchAndHashContent(url, visitedUrls = new Set()) {
    if (visitedUrls.has(url)) {
        return '';  // Avoid fetching the same URL multiple times to prevent infinite loops
    }

    visitedUrls.add(url);
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const content = response.data.toString('utf-8');
    // Parse HTML content to identify linked resources
    const root = parseHtml(content);
    const linkedResources = root.querySelectorAll('link[rel="stylesheet"], script[src]');
    // Fetch and hash linked resources
    const linkedResource = await Promise.all(linkedResources.map(async (resource) => {
        const resourceUrl = parseUrl(resource.getAttribute('href') || resource.getAttribute('src'), true);
        let absoluteResourceUrl = resourceUrl.href;
        if (!resourceUrl.hostname) {
            if (!resourceUrl.path.startsWith('/') && !url.endsWith('/'))
                url += '/';
            absoluteResourceUrl = `${url}${resourceUrl.path}`;
        }
        const resourceContent = await fetchAndHashContent(absoluteResourceUrl, visitedUrls);
        return `${resourceUrl.path}_${resourceContent}`;
    }));

    // Combine the content and hashes of linked resources
    return `${content}_${linkedResource.join('_')}`;
}

const hashCache = new Map();
// API endpoint to start the recursive download and hashing
app.post('/hash', async (req, res) => {
    try {
        let { urls } = req.body;
        if (!urls) {
            return res.status(400).json({ error: 'Missing <urls> in the request parameters' });
        }
        if (!Array.isArray(urls))
            urls = [urls];
        const promises = urls.map(async (url) => {
            const urlWithoutHashAndQuery = parseUrlWithoutHashAndQuery(url);
            let hash;
            // regex to identify owner and repo name from https://owner.github.io/repo-name
            const githubRepoRegex = /https?:\/\/([\w-]+)\.github\.io\/([\w-]+)/;
            if (githubRepoRegex.test(urlWithoutHashAndQuery)) {
                const [, owner, repo] = githubRepoRegex.exec(urlWithoutHashAndQuery) || [null, null, null,];
                const { data } = await axios.get(`https://api.github.com/repos/${owner}/${repo}`);
                const lastUpdated = new Date(data.pushed_at);

                const cached = hashCache.get(urlWithoutHashAndQuery);
                if (cached && cached.lastUpdated >= lastUpdated) {
                    hash = cached.hash;
                } else {
                    const hashedContent = await fetchAndHashContent(urlWithoutHashAndQuery);
                    hash = await hashContent(Buffer.from(hashedContent, 'utf-8'));
                    hashCache.set(urlWithoutHashAndQuery, { hash, lastUpdated });
                }
            } else {
                const hashedContent = await fetchAndHashContent(urlWithoutHashAndQuery);
                hash = await hashContent(Buffer.from(hashedContent, 'utf-8'));
            }

            return { url, hash };
        });

        let results = await Promise.all(promises);
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start the server
app.listen(port, host, () => {
    console.log(`Server is running at http://${host}:${port}`);
});

// Export the Express API
module.exports = app;
