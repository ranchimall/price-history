require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
app.use(express.json());
app.use(cors());

// rate limiter
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20 // limit each IP to requests per windowMs
});
app.use(limiter);

// connect to MongoDB
mongoose.connect(`mongodb://${HOST}/price-history`);
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
    console.log('Connected to MongoDB');
});

app.get("/", (req, res) => {
    res.send(`
        <title>RanchiMall Price History API</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: sans-serif;
            }
            h1{
                font-size: 2rem;
                margin-bottom: 2rem;
            }
            a{
                color: inherit;
            }
            table {
                border-collapse: collapse;
            }
            table, th, td {
                border: 1px solid black;
                padding: 0.5rem;
            }
            code {
                display: inline-block;
                background-color: #eee;
                padding: 0.3rem;
                border-radius: 0.2rem;
                font: monospace;
            }
            @media (prefers-color-scheme: dark) {
                body {
                    background-color: #222;
                    color: #eee;
                }
                table, th, td {
                    border-color: #eee;
                }
                code {
                    background-color: #333;
                    color: #eee;
                }
            }

        </style>
        <section style="padding:4vw;">
            <h1>
                Welcome to the RanchiMall Price History API!
            </h1>
            <h3>
                Available endpoints:
            </h3>
            <ul>
                <li>
                    <a href="/price-history">/price-history</a>
                </li>
            </ul>
            <h3>
                Query parameters:
            </h3>
            <table>
                <thead>
                    <tr>
                        <th>Parameter</th>
                        <th>Required</th>
                        <th>Default</th>
                        <th>format | values</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>from</td>
                        <td>No</td>
                        <td>None</td>
                        <td>YYYY-MM-DD</td>
                    </tr>
                    <tr>
                        <td>to</td>
                        <td>No</td>
                        <td>None</td>
                        <td>YYYY-MM-DD</td>
                    </tr>
                    <tr>
                        <td>on</td>
                        <td>No</td>
                        <td>None</td>
                        <td>YYYY-MM-DD</td>
                    </tr>
                    <tr>
                        <td>limit</td>
                        <td>No</td>
                        <td>100</td>
                        <td>all | &lt;number&gt;</td>
                    </tr>
                    <tr>
                        <td>asset</td>
                        <td>No</td>
                        <td>btc</td>
                        <td>btc</td>
                    </tr>
                    <tr>
                        <td>currency</td>
                        <td>No</td>
                        <td>All</td>
                        <td>usd | inr</td>
                    </tr>
                </tbody>
            </table>
            <h3>
                Example:
            </h3>
            <ul>
                <li>
                    <code>
                        /price-history?from=2020-01-01&to=2020-01-31
                    </code>
                </li>
            </ul>
        </section>
    `);
})

const PriceHistory = require('./models/price-history');

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

app.get("/price-history", async (req, res) => {
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

app.post("/price-history", async (req, res) => {
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

app.listen(PORT, HOST, () => {
    console.log(`Listening on ${HOST}:${PORT}`);
});
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

