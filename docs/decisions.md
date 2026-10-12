# Decisions

## 2026-10-07: Stack

- **Installable web app (PWA), mobile-first.** No app stores, shareable by link. Car integration (Android Auto / CarPlay) is a possible later add-on; camera images are not expected to be allowed on car screens while driving.
- **TypeScript everywhere, SvelteKit.** One language for pages and server code. Chosen for small, fast pages on weak mountain signal.
- **Single Node server (SvelteKit adapter-node).** Target is about 1,000 users on one small server. Camera and weather files are read into memory, and upstream fetches (WSDOT, NWS) are cached so load on providers stays low.
- **Files in git remain the source of truth** for cameras and weather sources (see data-model.md).
- **Secrets stay in environment variables**, never in the repo.

## 2026-10-07: Trip mode is the differentiator

Windy.com already offers a map of cameras, so OS Cams focuses on the drive: enter From and To, get the cameras (and conditions) along the road in the order you will pass them, stopping at the destination. "Follow my trip" uses the phone's location to hide cameras already passed and show the next one ahead.

- Routes and place search use Azure Maps when `AZURE_MAPS_KEY` is set (live traffic, business names), within a monthly limit per kind that keeps it inside the free monthly amounts (see 2026-10-12, Azure Maps costs). Past the allowance, or when Azure finds no route (it knows about seasonal closures, and won't start from a point far from a road), the free services take over: the OSRM demo server for routes, Photon then Nominatim then Open-Meteo for places. As-you-type suggestions stay on Photon, with Azure only as its backup, so typing doesn't spend the allowance.
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

## 2026-10-12: Before and after

The pass-camera replay keeps every picture from the last two hours, plus one every half hour back to six hours, so "6 AM bare, 9 AM snow" can be shown. "Share before and after" puts the newest picture next to one from 30 minutes to 6 hours earlier and gives it a link (`/moments/<id>`). The replay is in memory, so the two pictures are saved to disk (`MOMENTS_DIR`, next to the visit counts by default) and kept 30 days; the same two pictures always get the same link. Its link preview is the two pictures side by side with their times.

## 2026-10-12: Azure Maps costs

Azure Maps cost about 50 cents a day with very few visitors. Causes: the daily allowance (150 routes a day) allowed far more than the 1,000 free routes a month; the count lived in memory, so every deploy started it again; local testing used the real key; and search engines could load drive pages, each a new route. Now each kind has a monthly limit inside the free amount (90%), at most three days' share in one day, saved to a file so restarts keep it, and shown on `/stats`. `robots.txt` keeps search engines off `/trip` (link-preview readers may still load it). Test locally without `AZURE_MAPS_KEY`; the free services cover everything.

## 2026-10-12: Road ahead: closures, chains for your vehicle, weather warnings

App reviews of the state apps and road-weather apps, and news of drivers stranded by phone-map detours, showed three gaps: weather apps showing "10% snow" in a blizzard, no plain answer to "do I need chains with my AWD?", and phone maps sending drivers around closed highways onto unplowed back roads (Ruckle Road and Dead Indian Memorial Road in Oregon, County Road 511 at Tahoe).

Neither routing service knows when a state closes a pass (Azure Maps' traffic data has some closures, OSRM has none), so the router only draws the road and every drive is checked against the states' own reports. A drive over a closed pass, or over a road that closes for the winter when nothing says it is open, goes over the nearest open pass instead (up to four tried, shortest first) and says so; when no open way exists the page says that and does not pretend. Azure Maps routes avoid unpaved roads; OSRM routes report miles on very slow roads (dirt and forest roads) with a warning. Full road closures from WSDOT, ODOT and Caltrans that touch the route are listed, but not routed around: their locations are points, and a point can be on a bridge over the road. National Weather Service warnings that matter on the road (winter storms, floods, high wind, dense fog, avalanche) are matched to the drive by forecast zone and drawn area, for the time you reach each point. A source that can't be reached is named on the page, so silence never reads as an all-clear.

"What are you driving?" (car, AWD or 4WD, towing or over 10,000 lb) turns each pass's report into one answer, read from WSDOT's wording, ODOT's levels A to D and Caltrans R-1 to R-3, for the direction you are driving when the report gives one. The choice stays on the device. The state's own words stay under each answer.

## 2026-10-12: A page for every pass, made to be found

Every mountain pass has its own page at `/passes/<id>`, so that "Snoqualmie Pass conditions" finds us before the first snow. Old place links for passes (`/search?place=snoqualmie-pass`) forward there. The page opens with what a driver needs first: the state's report and, once reports run, today's chains rule for a car, an AWD or 4WD, and a vehicle towing or over 10,000 lb. Then snow on the ground at the nearest SNOTEL station, the avalanche danger for the zone (marked as backcountry: the state closes the highway itself), the forecast and the cameras, the other ways across with their status, and a few plain questions and answers built from the live data. Our audience is the occasional driver crossing to see family, not truckers, so the words stay plain.

Every page now has its own description for search results and link previews (the layout used to give every page the same one), place and pass pages name one address for search engines (`rel=canonical`), `/sitemap.xml` lists the passes, places and lists, and `robots.txt` is served by the app so it can point to the sitemap on whatever address the app runs at. Drive pages stay out of search, and single camera pages are left out of the sitemap for now.

## 2026-10-12: What's a traction tire?

Drivers who rarely cross a pass don't know what "traction tires required" asks of them, and the three states mean different things by it (in Oregon M+S alone is not a traction tire; in Washington it is, with 1/8 inch of tread). `/tires` explains how to check your own tires, what each state's signs mean for a car, an AWD and a trailer, and how to use chains, written from WSDOT, ODOT and Caltrans rules and linked from every pass page, the drive page and the footer.

## 2026-10-12: Pass history

The states publish today's pass report but no history anyone can read, and people ask how often a pass needs chains. Every 10 minutes the server notes each pass's report, keeps the worst of each day, and saves the days to `pass-history.json` next to the visit counts (`PASS_HISTORY_FILE`), merged with any copy another server saved during a deploy and kept for 400 days. A pass page shows this season's count of chain, closed and traction-tire days, the last of each, and the last 30 days as coloured squares. A day a state's feed was down is left out, never counted as open.

## 2026-10-12: Chain checkpoints (California only)

California pass pages list Caltrans's chain-control checkpoints on the pass's highway within about 25 miles, with the level at each now (the full list folds away; the ones in effect show first). A drive in California shows any chain control in effect on its road, for its direction, with the answer for the driver's vehicle. Caltrans lists some checkpoints up to four times; we keep one, the strictest. Washington and Oregon chain-up areas are not shown: neither WSDOT nor ODOT publishes their locations as data, OpenStreetMap has one, and a wrong chain-up location is worse than none, so we wait for an official source rather than typing them in by hand.

## 2026-10-12: Drive pages stay fresh while they are open

A drive page is often opened before leaving and left on the dash, and mountain weather changes by the hour: sunny in Seattle at 5, ice forming in the shade at Snoqualmie by 6:30. Before, only the camera pictures updated; the pass reports, warnings and weather stayed as they were when the page loaded. Now the page asks `/api/trip/live` every 5 minutes (and when the screen comes back on) for fresh pass reports, chains, closures, Caltrans chain controls, National Weather Service warnings, weather on the way, the snow line and roadside readings. It sends the route it already has, so it never asks a routing service again, and the weather for these refreshes always comes from Open-Meteo, so Azure Maps' monthly allowance is not touched.

New: WSDOT's road weather stations measure the pavement itself, so the page says when the road surface beside the route is at or near freezing ("Road surface at freezing at Denny Creek: 31°F. Ice can form"), and forecasts now flag "Ice possible" when the road was wet in the last three hours and it is 33°F or colder when you get there.

Each update is compared with the last, and what got worse on the road still ahead is shown at the top ("Changed at 6:31 PM"), with a buzz for the worst news and, while following, read aloud (it can be turned off). Two forecast services can disagree, so the first update after the page loads only sets the baseline for weather.

While following, every time counts from where you are, not from when you set out. Leaving the planned route for a minute plans the drive again from where you are (as a navigation app would), keeping the destination and the stops still ahead, which covers every way out of a city without guessing them. The original start stays in the link (`of`), so sharing a re-planned drive never shares your position, and it is not added to recent drives again. A lost GPS signal (tunnels, snow sheds) no longer stops following; only a refusal does.

## 2026-10-12: Telling search engines

Google reads `/sitemap.xml` once the site is verified in Google Search Console (the owner's Google account; verify the domain through Cloudflare, then submit the sitemap). Bing, Yandex, Seznam and Naver take IndexNow, which needs no account: `static/<key>.txt` proves the site is ours (the key is public by design) and `node scripts/indexnow.mjs` sends every page in the sitemap. Run it after a deploy that adds or renames pages. Bing's index is also what several AI answer services search.

## 2026-10-12: One visitor can't use up what everyone shares

Azure Maps can't cost money past its free amounts (the monthly and daily limits stop it), but one bot could use up a day's share in minutes and leave everyone else on the free services. Each visitor (by address, known to everything a request starts through `src/lib/server/visitor.ts`) may now cause at most 10 routes, 30 searches and 10 weather requests an hour; past that, the free services answer for them. The free services get overall limits too, so we stay welcome there: Open-Meteo forecasts at most 120 a minute and 8,000 a day (its free allowance is about 10,000), Weather Service point lookups 240 a minute. A drive page refreshing on the dash may ask for an update 12 times a minute at most.

## 2026-10-12: The answer at a glance

People don't want to read before a drive; they want to know if they're OK to go. Every drive and pass page now opens with one coloured card: green "Looks good", amber "Go prepared", red "Not now" (or "Closed"), grey "Check before you go"; one sentence with the main reason; and up to four small facts with an icon each ("Stevens Pass: no chains needed for AWD", "38°F cloudy at Stevens Pass 7:10 PM", "Road 31°F"). It is built from what the page already has (pass reports for the chosen vehicle, closures, chain controls, warnings, road surface, weather when you get there) and follows the page's 5-minute updates. A pass with no report is shown as such, never counted as clear, and when sources couldn't be checked the card is grey. The vehicle choice sits in the card because it changes the answer. On a drive, the road, chains and weather details fold behind one tap; the cameras stay in view. Sharing a drive sends the card's sentence, and the first update after "Follow my trip" reads it aloud.

## 2026-10-12: Cameras on the first screen

A first-time visitor (an airport-to-Snohomish drive) had to scroll a screen and a half past controls, notes and weather before the first camera, on an app that is meant to be looked at. Measured at phone size (412 by 915), the first camera now starts at about 420 to 500 px on drives and pass pages (it was 730 on a drive and 1,530 on a pass page). On drives: a smaller title with short place names, the answer card (with "As of 4:24 PM" and the vehicle buttons inside it, short labels: Car, AWD/4WD, Towing), one row of tools (Follow, a share icon, reverse, a "Leave now" picker), and the details folded behind "More: road, chains, weather"; "Show all cameras" moved below the list. On pass pages: the answer card (with snow on the ground once it loads), chains today as one line when every vehicle gets the same answer, then the cameras; snow, avalanche, the season, checkpoints, the other passes, the forecast and the questions follow the cameras.
