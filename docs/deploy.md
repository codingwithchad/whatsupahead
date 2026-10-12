# Running your own copy

What's Up Ahead is one Node server. Any host that runs Node 24 works: a small virtual machine, a container
platform or a platform-as-a-service. Nothing in the app is tied to one provider.

## Build and start

```
npm ci
npm run build
node build          # listens on PORT (default 3000)
```

The server needs the `build/` folder, the `data/` folder and the production packages (`npm ci --omit=dev`). It
reads all data files into memory when it starts, so camera and place changes go live on the next deploy.

About 250 MB of memory is enough for the current data. Use an always-on plan if you can: the pass-camera replay
lives in memory and starts empty after every restart.

## Settings

Everything is optional. Without any keys the app still runs: cameras that need no key, NWS forecasts, place search
and routes on free public services. Copy `.env.example` to `.env` for local use; on a host, set the same names as
environment variables. Never commit keys.

### Keys for live data

| Variable | What it turns on | Get one |
|---|---|---|
| `WSDOT_CODE` | Washington pass reports, ferry space, border waits, weather stations | [WSDOT Traveler Information API](https://wsdot.wa.gov/traffic/api/) |
| `ORDOT_CODE_PRIMARY` | Oregon pass reports (ODOT crew reports and closures) | [ODOT API portal](https://apiportal.odot.state.or.us/) |
| `WINDY_API_KEY` | Cameras that come through Windy.com | [Windy Webcams API](https://api.windy.com/keys) |
| `YOU_TUBE_DATA_API_KEY` | Checks that YouTube live cameras are still live | Google Cloud, YouTube Data API v3 |
| `AZURE_MAPS_KEY` | Optional routing and place search with live traffic; without it, routes use OSRM and place search uses Photon and Nominatim | Azure Maps account |
| `GITHUB_ISSUES_TOKEN` | Lets the "Add a camera" form file suggestions as issues | A fine-grained GitHub token, Issues read and write, one repository |

California's Caltrans data, the National Park Service, NOAA and the NWS need no key.

`/healthz` shows which keys are set (true or false, never the values) and whether each outside source is
answering, so you can check a new deploy.

### Running behind a proxy or load balancer

| Variable | Use |
|---|---|
| `TRUSTED_PROXIES` | How many `X-Forwarded-For` entries your proxies add (often 1). The rate limits use it to find the visitor's address; `/healthz` shows `forwarded_hops` so you can measure it. |
| `PROTOCOL_HEADER=x-forwarded-proto` | Tells the server the visitor used https, so forms pass the same-site check. (`ORIGIN=https://your.site` works too.) |
| `CANONICAL_HOST` | Your main address, for example `example.com`. Every other address (www, the host's own default address) forwards there. Set it only once that address works with https. |

### Saving data between restarts

| Variable | Use |
|---|---|
| `STATS_FILE` | Where the anonymous visit counts (`/stats`) are saved. Point it at a disk that survives restarts and deploys. Default `.stats/stats.json`. |
| `STATS_BLOB_URL` | Instead of a file, keep the counts in an Azure Blob Storage blob, written with the host's managed identity (no keys). Leave it unset to use the file. |

### Tuning

| Variable | Use |
|---|---|
| `AZURE_MAPS_DAILY` | Daily allowance for each kind of Azure Maps request (default 150), so you stay inside its free amount. |
| `HISTORY=off` | Turns off the pass-camera replay (saves memory). `HISTORY_EVERY_SECONDS` changes how often it records (default 300). |
| `HEALTH_CHECKS=off` | Turns off the half-hourly checks of outside sources. |
| `DATA_DIR` | Read data files from somewhere other than `./data`. |

## Health check

Point your host's health check at `/healthz`. It answers 200 with the number of cameras and places loaded, the
commit that is running (`version.commit`, from git at build time), and the state of each outside source. Checking
`version.commit` after a deploy tells you the new build is the one answering.

## Your own domain

Add the domain at your host, wait until it serves https, then set `CANONICAL_HOST`. If you use the Windy API, update
the project address on your Windy key page too.

## Using your copy's data

The data files belong to this project, but the camera pictures belong to their owners. Each source's terms are in
[sources.md](sources.md); some (ODOT, Windy) set rules about how pictures are shown, which the app already follows.
Get your own keys for each service rather than reusing someone else's.
