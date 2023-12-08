require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createHash } = require('crypto');
const archiver = require('archiver');
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

function parseUrlWithoutHashAndQuery(fullUrl) {
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

    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    const content = response.data.toString('utf-8');

    // Parse HTML content to identify linked resources
    const root = parseHtml(content);
    const linkedResources = root.querySelectorAll('link[rel="stylesheet"], script[src]');
    // Fetch and hash linked resources
    const linkedResourceHashes = await Promise.all(linkedResources.map(async (resource) => {
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
    return `${content}_${linkedResourceHashes.join('_')}`;
}


// API endpoint to start the recursive download and hashing
app.post('/hash', async (req, res) => {
    try {
        let { urls } = req.body;
        if (!urls) {
            return res.status(400).json({ error: 'Missing URL in the request parameters' });
        }
        if (!Array.isArray(urls))
            urls = [urls];

        const promises = urls.map(async (url) => {
            const urlWithoutHashAndQuery = parseUrlWithoutHashAndQuery(url);
            console.log(url, `Fetching and hashing ${urlWithoutHashAndQuery}`);
            const hashedContent = await fetchAndHashContent(urlWithoutHashAndQuery);
            const fileHash = await hashContent(Buffer.from(hashedContent, 'utf-8'));
            return { urls, fileHash };
        });

        let results = await Promise.all(promises);
        results = results.reduce((acc, { urls, fileHash }) => {
            acc[urls] = fileHash;
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
app.listen(port, host, () => {
    console.log(`Server is running at http://${host}:${port}`);
});

// Export the Express API
module.exports = app;
