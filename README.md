# Will It Sail? — CalMac Sailing Predictor

An unofficial, community-built tool that predicts whether CalMac ferry routes are likely to sail, based on:

- 🌬️ **Wind forecasts** (via [Open-Meteo](https://open-meteo.com) — free, no API key needed)
- 🚢 **CalMac service alerts** (scraped from CalMac’s public service status page)
- 📊 **Risk algorithm** combining gust speeds, weather codes, and live alerts

-----

## Project Structure

```
calmac-predictor/
├── index.html        ← Frontend (single page)
├── api/
│   ├── weather.js    ← Serverless: fetches wind data for all 22 routes
│   └── status.js     ← Serverless: scrapes CalMac service status
├── vercel.json       ← Vercel routing config
└── README.md
```

-----

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/calmac-predictor.git
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
1. Click **Add New Project**
1. Import your GitHub repo
1. Leave all settings as default — Vercel will detect the serverless functions automatically
1. Click **Deploy**

That’s it! No environment variables or build steps needed.

-----

## How the Prediction Works

|Gust Speed|Risk Added|
|----------|----------|
|< 25 mph  |+0        |
|25–34 mph |+10       |
|35–44 mph |+25       |
|45–54 mph |+45       |
|55+ mph   |+60       |

|Weather Condition|Risk Added|
|-----------------|----------|
|Light cloud/clear|+0        |
|Drizzle          |+5        |
|Rain             |+15       |
|Heavy showers    |+25       |
|Snow             |+30       |
|Thunderstorm     |+40       |

**Final verdict:**

- 🟢 **Likely** — Risk < 25, no CalMac alert
- 🟡 **Caution** — Risk 25–54, or Amber alert
- 🔴 **At Risk** — Risk 55+, or Disrupted/Cancelled alert

-----

## Disclaimer

This is an **unofficial** tool not affiliated with Caledonian MacBrayne. Always check [CalMac’s official service status](https://www.calmac.co.uk/service-status) before travelling.
