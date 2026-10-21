# Camera data model

Cameras are data, never code. Adding or removing a camera never requires a code change.

Each camera is one JSON file in `data/cameras/<region>/`, named `<id>.json`, validated by `schema/camera.schema.json`.

## Regions

The app covers the regions listed in `data/regions.json` (today Washington `us-wa`, Oregon `us-or`, California `us-ca`, Idaho `us-id`, Nevada `us-nv` and Utah `us-ut`): name, bounds (and an
outline where the border is a river), time zone and ZIP code pattern. Cameras, weather sources, places and passes live in a
folder per region (`data/cameras/us-or/...`); drives and collections can cross borders and stay at the top level. The tests
check every file sits inside its region.

Adding a region: add it to `data/regions.json`, run `node scripts/build-gazetteer.mjs` for its offline town list, then
add data files (or an import script for that state's DOT feed) under its folder. Place search, local times and
automatic NWS forecasts follow from the regions file.

`data/areas.json` lists mountain areas (the Sierra Nevada and Tahoe, the Wasatch...): an id, a name and a box
(`[west, south, east, north]`). With the states, they are what the passes and ski areas lists can be narrowed to
(`/passes?in=sierra`, `/collections/ski-areas?in=utah`), so one storm can be shared on its own. A place is in an area when
it sits inside the box; a state goes by the state each place is in. The tests check each area holds a pass or ski area.

| Field | Required | Notes |
|---|---|---|
| id | yes | Slug, matches filename |
| name | yes | |
| lat, lon | yes | Decimal degrees |
| feed_url | yes | The raw feed |
| feed_type | yes | `image`, `video`, or `stream` |
| source | yes | Operator, e.g. WSDOT |
| status | yes | `pending` or `approved` |
| created_at | yes | ISO 8601 |
| approved_by | if approved | |
| submitted_by | no | |
| page_url | no | Attribution link |
| refresh_seconds | no | For image feeds |

## Approval

The app only shows `approved` cameras. New submissions arrive as `pending`. Approval means changing `status` and setting `approved_by`.

Future submission paths (web form, GitHub PR) write this same format. Not built yet.

## Optional fields

`description`, `elevation_m`, `heading`, `route`, `milepost`, `embed_mode` (`direct`, `iframe`, `proxy`, `link`), `license_or_terms`, `attribution_text`, `tags`.

Tags are free-form labels such as `road`, `mountain`, `summit`, `surf`, `weather`. They are optional and only used for filtering.

## Locations are derived, not stored

A camera does not belong to an area. Search returns every approved camera within a radius of the searched point, so nearby places overlap naturally (a park and a beach next to it can share cameras). There is no `area` field.

## Not stored here

Live health data (last checked, is live) changes constantly and does not belong in git. It will live in a separate store later.

## Seasonal cameras

Some cameras are off for part of the year (ski resort cams in the off-season). Set `availability: seasonal` with `expected_return` (YYYY-MM) and a `seasonal_note`. `feed_url` is then optional, but `page_url` is required so we keep the link in the data.

The app should show these as a clearly labeled placeholder ("not broken, back in November"), not as an error and not as a bare link. When the feed is live, set `availability: live` and add `feed_url`.

`location_precision: approximate` marks coordinates that are a best guess (e.g. the base area) until exact positions are known.

## Weather sources

Conditions are data too. Each file in `data/weather-sources/` (schema: `schema/weather-source.schema.json`) points at one place to get conditions for a location: an NWS forecast, a WSDOT weather station, or a pass report (`wsdot-pass` for Washington, `dot-pass` for Oregon and California, whose `provider_ref` is the pass id in `data/passes/`). Search returns nearby weather sources the same way it returns nearby cameras.

The files only say where to look. The app fetches live values at view time. API keys are never stored: `requires_key` names an environment variable (e.g. `WSDOT_CODE`).

Same seasonal rule as cameras: if a source is quiet in the off-season, mark it `seasonal` and show a clear "not broken" placeholder.

NWAC avalanche-center stations (Brooks Chair, Tye Mill/Skyline, Grace Lakes, Berne) are a possible later addition. They publish readings only, no cameras, and we have not confirmed a usable API.

## Provider cameras (Windy.com)

A camera can set `provider: "windy"` and `provider_ref` (the Windy webcam id) instead of `feed_url`. Windy picture links expire, so they are never stored: the server asks Windy for the current link at view time (cached about 5 minutes) and needs `WINDY_API_KEY`.

Windy's terms, which the app follows: show images no larger than the API size, use the API's links unchanged, link every image to its Windy page, and show "Webcams provided by Windy.com" on pages that use them.

To find candidates near a place: `node --env-file=.env scripts/windy-nearby.mjs <lat> <lon> [radius_km]`. Many Windy cameras duplicate WSDOT ones; the script flags those.

## Collections, ferries and border crossings

A collection (`data/collections/`, schema `collection.schema.json`) is a section on the home page that groups related places, such as every ferry terminal. A place joins by setting `collection` to the collection's id; places in a collection are listed on that collection's page (`/collections/<id>`) instead of the main home list.

- **Ferries:** one place per WSF terminal (`ferry-<name>`), each with its WSDOT cameras and a `ferry` weather source (`provider: wsdot-ferry`, `provider_ref` = WSF terminal id) that shows the next sailings and drive-up space.
- **Border crossings:** one place per crossing (`border-<name>`), each with nearby WSDOT cameras and a `border` source (`provider: wsdot-border`, `provider_ref` = comma-separated WSDOT crossing names) that shows wait times by lane. WSDOT reports -1 when a lane has no data.

Both use the WSDOT access code (`WSDOT_CODE`), so today they cover Washington only. Places overlap by distance, so a camera near two crossings appears in both.

## Featured drives

Files in `data/drives/<state>/` (schema `drive.schema.json`) are ready-made trips shown on the home page under "Drives this season". `from` and `to` can be a town, zip, address, a place id, or `lat,lon` (coordinates skip the place search; set `from_label` to name them). `season` (`"from": "09-15", "to": "12-31"`, may wrap past New Year) says when it shows, `blurb` says why now, and `state` lets the home page take turns between states (up to six at a time). Example: `us-wa/seattle-leavenworth`.

## Airports

The `airports` collection has one place per airport (`airport-<name>`), each with the WSDOT cameras on the roads in, any airport cameras (via Windy), and three weather sources:
- `faa-status` (kind `airport`): current FAA ground stops, ground delays, arrival and departure delays and closures. The FAA feed lists only airports with a problem, so no entry means "none reported". Notices that only restrict general aviation are ignored.
- `nws-obs` (kind `station`): the airport's own weather station (sky, temperature, visibility, wind). Visibility matters for flights.
- A normal NWS forecast.

Security checkpoint wait times are not included: there is no official open feed, and the third-party estimates found were not reliable.

To add a drive's cameras in one step: `node --env-file=.env scripts/import-wsdot-route.mjs "<from lat,lon>" "<to lat,lon>" [corridor_miles] [tag]`, then add a file in `data/drives/` and a forecast source (`nws-forecast-<place>`) at each end.

## Rivers

A `river` weather source (`provider: nwps`, `provider_ref` = NOAA gauge id such as `SNAW1`) shows the river level now, whether it is rising or falling, the forecast high and where flood stage starts, from NOAA's National Water Prediction Service. Gauges along a drive appear in its weather strip. Find a gauge id with `https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=...` (a bounding box around the place).

## Mountain passes

`data/passes/` (schema `pass.schema.json`) lists the passes on the `/passes` page: the road, which towns it connects, a group, and the `place` page that shows its cameras and weather. Each shows a status tag: Open (or "No chain controls"), Traction tires advised, Chains required, Closed, or No report yet. Where the report comes from depends on the state (`src/lib/passes.ts`):

- **Washington:** WSDOT's pass reports, by WSDOT's `pass_id`. Its hand-written restriction text is turned into a status, taking the worse of the two directions.
- **Oregon** (`report.source: "odot"`): ODOT's crew road-and-weather reports on the pass's highway (`report.route`, as ODOT writes it, e.g. `US20`) within `radius_km` of the summit (default 15), plus ODOT closures there.
- **California** (`report.source: "caltrans"`): Caltrans chain-control checkpoints on the highway (e.g. `SR-89`) near the summit, plus full closures from Caltrans's lane-closure list. `districts` names the Caltrans districts to fetch; `closures: false` skips the closure list where it is very large.

`winter_closure` marks roads that close for the season (Tioga, Sonora, McKenzie); in deep winter they are not shown as open just because nothing is listed. Crews report mostly November to April, so many passes read "No report yet" in summer.

`road` is the pass's highway for some miles each side of the summit, as an encoded line, made by
`node scripts/build-pass-roads.mjs --write` (run it again after adding passes or cameras). With it, the pass page
lists cameras in the order you'd pass them and offers Eastbound/Westbound (or Northbound/Southbound, as the
highway is signed); picking a way leaves out cameras whose names say they look the other way ("Kingvale WB",
"Looking East"). Passes with fewer than three cameras on their highway have no line and list cameras nearest first.

## Camera replay

The server saves a small picture from each camera within 6 miles of a pass (WSDOT, WSDOT Aviation, Caltrans and National Park Service only; never Windy, and not ODOT, whose terms cover showing the current picture) about every 5 minutes and keeps the last 2 hours in full and older pictures half an hour apart for 6 hours, on disk (`HISTORY_DIR`, or a `replay` folder next to `STATS_FILE`) so restarts don't empty it; without either it stays in memory. Enlarging a camera shows a replay with play, pause and a slider. `HISTORY=off` turns recording off; `HISTORY_EVERY_SECONDS` changes the interval.

## Themed places

A place can set `camera_tags` (for example `["scenic"]`) to list only cameras carrying one of those tags instead of every camera within its radius. "Seattle sights" uses this so six landmark cameras are not buried under a hundred road cameras. `weather_radius_miles` keeps such a wide place from pulling in far-away weather reports.

## The All places directory

`/places` shows every place as a tree: state, then the kind of place (featured places, mountain passes, ferries, airfields and so on), then the places. Kinds start folded; typing in the search box opens only the kinds with matches. A place's state comes from its optional `state` field and defaults to the state its coordinates are in; set it when adding places in another state so they group under their own state.
