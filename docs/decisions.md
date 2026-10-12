# Decisions

## 2026-10-07: Stack

- **Installable web app (PWA), mobile-first.** No app stores, shareable by link. Car integration (Android Auto / CarPlay) is a possible later add-on; camera images are not expected to be allowed on car screens while driving.
- **TypeScript everywhere, SvelteKit.** One language for pages and server code. Chosen for small, fast pages on weak mountain signal.
- **Single Node server (SvelteKit adapter-node).** Target is about 1,000 users on one small server. Camera and weather files are read into memory, and upstream fetches (WSDOT, NWS) are cached so load on providers stays low.
- **Files in git remain the source of truth** for cameras and weather sources (see data-model.md).
- **Secrets stay in environment variables**, never in the repo.

## 2026-10-07: Trip mode is the differentiator

Windy.com already offers a map of cameras, so OS Cams focuses on the drive: enter From and To, get the cameras (and conditions) along the road in the order you will pass them, stopping at the destination. "Follow my trip" uses the phone's location to hide cameras already passed and show the next one ahead.

- Routes and place search use Azure Maps when `AZURE_MAPS_KEY` is set (live traffic, business names), within a daily allowance per kind (`AZURE_MAPS_DAILY`, default 150) that keeps it inside the free monthly amount. Past the allowance, or when Azure finds no route (it knows about seasonal closures, and won't start from a point far from a road), the free services take over: the OSRM demo server for routes, Photon then Nominatim then Open-Meteo for places. As-you-type suggestions stay on Photon, with Azure only as its backup, so typing doesn't spend the allowance.
- Corridor 1.5 mi either side of the road, 2 mi buffer past the destination, 2.5 mi radius around the destination for places like resorts that sit off the road.
- Follow mode needs the page open and the screen on (it asks for a screen wake lock). It is meant for passengers and pre-trip checks, not for a driver to study.

## 2026-10-07: Home page order and "Places"

Home order: Plan a drive, Ferries & border, Places, search, install help. The three Places shown are: places this device viewed recently first (kept in the phone's localStorage, no accounts), then the places most viewed by everyone (anonymous in-memory counters that reset when the server restarts). Remaining places are under "All places". Recent free-text searches show as small chips under the search box.

## 2026-10-07: Forecasts are for when you arrive

On a trip, each forecast source shows the hourly forecast for the time you will be there: the time you leave (Now, +1 h, +2 h, +3 h; `?in=` minutes) plus the driving time to that point along the route. Live station readings (temperature, wind, border waits, ferry space) stay "now". Search by place still shows the current forecast.

Other camera sources were investigated for US 2 (USGS HIVIS river cameras, AlertWest, third-party lists). Only the cameras already added are confirmed; USGS HIVIS (for example the Bolt Creek camera near Skykomish) is a lead but its data API was not worked out yet.

## 2026-10-07: One start card, and filling in drives

The home page opens with one card with two modes: "One place" (search, recent searches, use my location) and "A drive" (From/To plus popular drives). The chosen mode is remembered on the device.

Long drives (I-5 has a camera every half mile) show spaced-out key cameras by default, up to 40, always keeping cameras from other sources; "Show all" lists every one. Trip weather shows forecasts at both ends plus a few roadside stations, and ferry, border and airport reports only when the drive ends there.

Drives are filled in with `scripts/import-wsdot-route.mjs`, which adds every working WSDOT camera and reporting weather station within about 0.6 miles of the route (it downloads each picture first and skips dead ones). Current drives: Everett to Stevens Pass, Seattle, Bellevue; Seattle to Bellevue, Tacoma, Snoqualmie Pass.

## 2026-10-07: No walls of text before the cameras

A zip search used to show 22 weather blocks (about 2,400 px) and 308 cameras. Now: a place search defaults to 10 miles; the weather strip shows at most 3 reports (the nearest forecast plus the nearest others; on trips, the forecasts at both ends plus one report on the way) and folds the rest under "N more reports"; each report is one or two lines (river level and forecast high, next sailing only, with the detail behind a small toggle); and the camera list shows the nearest 24 with "Show all". Featured places keep their own radius.

## 2026-10-07: Ferry, airport and border reports only when you're going there

Sailings, flight delays and border waits are shown only when the place (or the drive's destination) is a ferry terminal, airport or crossing (its collection), or the place's data opts in with `include_kinds` (Mukilteo shows sailings). Ordinary places and zip searches never show them, and drives only show them at the destination, where they are listed first.

## 2026-10-07: Home page polish pass 1

Slim header (about a quarter of its old height): camera mark, "OS Cams" and the slogan "Live views along your way." ("Know before you go" is what DOT sites say.) Browse became two-across tiles with an icon, name and place count; each collection sets its `icon` in its data file. The start card now sits right under the header so search and the tiles are visible without scrolling.

## 2026-10-07: Discovery and ski areas

Browse now ends with two utility tiles: "All places" (a filterable directory grouped by list) and "Near me" (the places we cover closest to you, using the phone's location). A state level was skipped since everything is Washington for now.

"Ski areas" lists the biggest Washington ski areas by skiable acres (Crystal Mountain about 2,600, 49 Degrees North about 2,300, Mission Ridge about 2,000, The Summit at Snoqualmie about 2,000, and Stevens Pass tied with Mt. Baker at about 1,125; sources disagree, so check before quoting). Only Stevens Pass (Windy cameras plus WSDOT) and Snoqualmie (WSDOT) have cameras we can reuse. Crystal, 49 Degrees North and Mission Ridge show a forecast plus a note and a link to the resort's own cameras. Places can carry a `note` and `link`, and a collection can list places from other lists with `also`. A place page shows only its nearest forecast.

Windy was searched widely around all seven ski areas (2026-10-07). A first pass skipped Windy's three "Mt. Baker" entries because they did not look like the ski area; on 2026-10-08, after a wider search, they were added with honest descriptions (an AlertWest lookout whose view can change, a distant view of Mt. Baker from the west, and a view from Acme toward the Twin Sisters and Baker), and the duplicate of the North Cascades park camera was left out. White Pass has WSDOT's summit camera. Each resort road has a seasonal WSDOT road-conditions report (Crystal also has Chinook Pass).

## 2026-10-07: Reliability pass and statewide cameras

- The cache now merges identical in-flight lookups, so many visitors asking for the same thing cause one outside request.
- Washington town and ZIP searches use an offline list built from the US Census Bureau Gazetteer (public domain; `node scripts/build-gazetteer.mjs`, data in `data/gazetteer/wa.json`). Other states and street addresses still go to the online search, with Open-Meteo as a backup.
- Home page counts are computed once every 10 minutes, and all data is read when the server starts.
- A camera picture that fails to load is retried once, then shows "Camera unavailable right now" until its next refresh.
- All working WSDOT cameras and reporting weather stations in the state were imported (`node --env-file=.env scripts/import-wsdot-route.mjs all`), so a trip between any two Washington places finds cameras along the way. Re-run it to pick up new WSDOT cameras; it skips ones we already have and ones that do not serve a real picture.

## 2026-10-07: Mountain passes and camera replay

Added a Mountain passes page (live status for every WSDOT pass) and a replay of the last 2 hours of pass-camera pictures so people can see snow building up. The status wording rules were written from WSDOT's usual phrasing and tested with sample text, but real winter wording was not available in October, so check chain-required and closure cases once WSDOT starts reporting around November 1 and adjust `classifyRestriction` if the wording differs. WSDOT has no public camera on the North Cascades Highway pass itself. Snow depth sources (for example NWAC weather stations) are a possible later addition.

## 2026-10-08: Pages are never empty

If a place has no live cameras inside its radius, the page shows the nearest working cameras (up to 6, within 75 miles) with their distance and a line saying so, instead of an empty message. This applies to every place and search. Eight places had been empty (Mt. Baker, Crystal Mountain, 49 Degrees North, Mission Ridge, three passes, and Sunrise); Mt. Baker now has its own cameras and the others show the nearest ones.

## 2026-10-08: New name, new look, own domain

The app is now "What's Up Ahead" (the question you ask before every trip), replacing "OS Cams", which could be misread as "O-scams". Tagline: "Cameras, weather and waits along your way." Chosen because it fits commutes, mountain passes and wait times, is not tied to Washington, and the .com was free. The free hosting address (`*.onrender.com`) looked suspicious to Reddit and to people, so the app moves to its own domain, and the old address forwards to it (`CANONICAL_HOST`). Also added: an About page and a footer on every page (what it is, sources, privacy, "not affiliated with WSDOT"), a link-preview image, and standard security headers. The look moved to a dusk mountain scene with an orange road and sun.

## 2026-10-09: More than one state

Regions come from `data/regions.json` (bounds, an outline where the border is a river, time zone, ZIP pattern), with each region's data in its own folder. Oregon came first, with ODOT's cameras through its official API. Place search, local times and automatic forecasts follow from the regions file.

## 2026-10-11: California, and pass reports in every state

California added about 3,380 Caltrans cameras (open data, no key) and the towns and ZIP codes from the Census. Oregon and California don't publish one report per pass the way WSDOT does, so a pass's report is built from what the state does publish on that highway near the summit: ODOT's crew road reports and closures, and Caltrans chain controls and full closures. Roads that close for the winter are never shown as open in deep winter just because nothing is listed. Ski areas link to the resorts' own cameras, which are not published for reuse.

## 2026-10-11: Host-neutral repository

The repository describes how to run the app on any Node host (docs/deploy.md) rather than one provider's steps. Optional integrations (a paid routing service, a cloud store for visit counts) are switched on by settings and the app works without them.

## 2026-10-11: Weather on the way

A trip shows the forecast at the start, at each pass the road crosses (within 2 miles of it), about every hour on long stretches, and at the destination, each for the time you will reach it: when you leave plus the driving time to that point. One Azure Maps Weather Along Route request covers the whole drive when its key is set (inside the same daily allowance as routes and searches); otherwise Open-Meteo's free hourly forecast. A line at the top names the worst point ("Heavy snow expected at Snoqualmie Pass when you get there").

## 2026-10-12: Sharing

Every camera now has its own page (`/cameras/<id>`), and cameras, places, lists and drives have a Share button: the phone's share menu where there is one, otherwise Copy link, Facebook (a plain link to Facebook's share page, so no Facebook code on our pages), Text and Email. A shared drive drops personal choices (leaving time, "show all").

Shared links show a picture made for that page (1200 by 630): the camera's latest picture, up to three of a place's cameras, one picture from each of a list's first places, or the drive drawn on a map with its passes, a camera at the first pass and one at the destination. Only sources whose owners allow reuse go in (docs/sources.md, Link previews); the rest get a card with the name. Text is drawn from a font that ships with the app (Inter, SIL Open Font License), so the pictures look the same on any server whether or not it has fonts installed.
