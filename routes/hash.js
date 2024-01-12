const express = require('express');
const router = express.Router();
const axios = require('axios');
const { createHash } = require('crypto');
const { parse: parseUrl, URL } = require('url');
const { parse: parseHtml } = require('node-html-parser');
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
router.get("/", async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'Missing <url> in the query parameters' });
    }
    res.json(await generateHash(url));
})
// API endpoint to start the recursive download and hashing
router.post('/', async (req, res) => {
    try {
        const { urls } = req.body;
        if (!urls) {
            return res.status(400).json({ error: 'Missing <urls> in the request parameters' });
        }
        res.json(await generateHash(urls));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
async function generateHash(urls = []) {
    if (!Array.isArray(urls))
        urls = [urls];
    const promises = urls.map(async (url) => {
        const urlWithoutHashAndQuery = parseUrlWithoutHashAndQuery(url);
        let hash;
        // regex to identify owner and repo name from https://owner.github.io/repo-name
        const githubRepoRegex = /https?:\/\/([\w-]+)\.github\.io\/([\w-]+)/;
        if (githubRepoRegex.test(urlWithoutHashAndQuery) && urlWithoutHashAndQuery.match(githubRepoRegex)[1] === 'ranchimall') {
            if (!hashCache.has(urlWithoutHashAndQuery)) {
                await fetchAndSaveAppHash(urlWithoutHashAndQuery)
            }
            hash = hashCache.get(urlWithoutHashAndQuery).hash;
        } else {
            const hashedContent = await fetchAndHashContent(urlWithoutHashAndQuery);
            hash = await hashContent(Buffer.from(hashedContent, 'utf-8'));
        }
        return { url, hash };
    });

    return await Promise.all(promises);
}
async function fetchAndSaveAppHash(url, lastUpdated = Date.now()) {
    const hashedContent = await fetchAndHashContent(url);
    const hash = await hashContent(Buffer.from(hashedContent, 'utf-8'));
    hashCache.set(url, { hash, lastUpdated });
}

router.post('/gitwh', async (req, res) => {
    try {
        // ignore if request is not from github
        if (!req.headers['user-agent'].startsWith('GitHub-Hookshot/'))
            return res.json({ message: 'ignored' });
        const { repository: { pushed_at, organization, name, has_pages } } = req.body;
        if (!has_pages)
            return res.json({ message: 'ignored' });
        const url = `https://${organization}.github.io/${name}`
        await fetchAndSaveAppHash(url, pushed_at)
        res.json({ message: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
})

module.exports = router;