# Each source's rules, and how we follow them

Every outside service the app or its scripts call, what that service asks of the people who use it, and what we do
to keep to it. Where a source publishes its rules, they are quoted or summed up with a link; where it publishes
none, that is said plainly, along with how we treat it. Checked 2026-10-19.

Read this before adding a source, changing how often we call one, or putting a source's pictures somewhere new
(link previews, the replay, videos). [sources.md](sources.md) says which cameras we use and why; this page is about
the services behind them. When a rule here and the code disagree, the rule wins: fix the code.

**Rules for every source**

- Identify ourselves. Every call to a service that asks for it sends `WhatsUpAhead (https://github.com/codingwithchad/whatsupahead)` as its User-Agent.
- One call serves everyone. Answers are kept (cached) on our server for minutes or hours, so a thousand visitors
  cost a source no more than one. The numbers below are those times.
- Keys never leave the server: not in the page or the repository, and the 511 feeds' error messages strip `key=`.
- Credit each source where its data shows, and on the [About page](https://whatsupahead.com/about).
- A picture goes into link previews, the replay or a video unless its owner's terms say no
  (`src/lib/sharing.ts`, `RECORDABLE` in `src/lib/server/history.ts`). A public agency that publishes no terms
  either way gets its own cameras used, credited, until it asks us to stop (decided 2026-10-22). Private owners
  and cameras an agency passes on for others still need a yes.
- If a source asks us to stop or change something, we do, and write it down here.

## At a glance

| Source | Key | Their limit | Our pace | Copies of pictures |
|---|---|---|---|---|
| WSDOT Traveler Information API | Access code | None published; "go easy on its servers" (WSDOT, 2026-10-13) | Feeds kept 2 to 5 minutes | Yes, credited "Camera courtesy of WSDOT" |
| ODOT TripCheck API | Subscription key | Developer portal terms | Kept 2 minutes | Our one refreshed copy only; never past ones |
| Caltrans CWWP2 | None | None published | Kept 5 to 10 minutes | Yes |
| Idaho 511 | Developer key | 10 calls a minute | 3 calls every 5 minutes | Yes, credited (no terms either way) |
| Nevada 511 | Developer key | 10 calls a minute | 3 calls every 5 minutes | Yes, credited (no terms either way) |
| UDOT Traffic (Utah) | Developer key | 10 calls a minute | 3 calls every 5 minutes | Yes, credited (no terms either way) |
| Windy Webcams API | Key | "Responsible" use | Kept 5 minutes | No (terms forbid it) |
| National Weather Service | None (User-Agent) | Not published; ask for an identifying User-Agent | Kept 3 minutes to a day | n/a |
| Open-Meteo | None | 10,000 a day, 5,000 an hour, 600 a minute, non-commercial | At most 8,000 a day, 120 a minute | n/a |
| OSRM (routing.openstreetmap.de) | None | 1 a second, attribution, "fix the map" link | At most 30 a minute | n/a |
| Nominatim | None | 1 a second, attribution, cache | One at a time, 1.1 seconds apart, kept a day | n/a |
| Photon (Komoot) | None | "Be fair" | At most 120 a minute, kept an hour | n/a |
| Azure Maps | Key (paid) | Our own budget | Stops at 90% of each free monthly amount | n/a |
| USDA SNOTEL (AWDB) | None | None published | Station list daily, readings 30 minutes | n/a |
| avalanche.org | None | None published | One call for every zone, kept 30 minutes | n/a |
| NOAA tides, buoys, river gauges; FAA; USGS; NPS; Census | None | None published (US government) | Kept 2 minutes to a day | NPS, USGS: yes |
| YouTube Data API (scripts only) | Key | Daily quota | Run by hand | Embeds only |
| IndexNow (script only) | Our own key file | None to speak of | Run by hand after big changes | n/a |
| Facebook Graph API (our own Page) | Page key | Meta's platform terms; posts only to our own Page | At most 3 posts a day in each state, 2 hours apart; 10 a day in all | Pictures follow the link-preview rules |

## State road departments

### WSDOT (Washington)

- **What for:** highway, pass, ferry, border and airfield cameras; pass reports; highway alerts (closures); road
  weather stations (pavement temperature); ferry space; border waits.
- **Key:** an access code from [wsdot.wa.gov/traffic/api](https://wsdot.wa.gov/traffic/api/) (`WSDOT_CODE`).
- **Their rules:** WSDOT publishes no rate limit. In reply to our request (2026-10-13) it allowed link previews and
  asked that we: credit each picture "Camera courtesy of WSDOT"; never call a picture "live" (only real video
  streams are live); go easy on its servers; and use only WSDOT's own cameras that way, not ones it passes on for
  others (City of Seattle, businesses), which it can't give permission for. It also noted that our use limits its
  ability to count how many people use its information.
- **What we do:** pass reports and alerts kept 2 minutes, road weather stations 5 minutes, ferries 2 to 10 minutes.
  Pictures are shown from WSDOT's own addresses; the replay keeps one picture every five minutes for a few cameras
  near passes. Cameras WSDOT relays for others are credited "via WSDOT" and kept out of previews.

### ODOT TripCheck (Oregon)

- **What for:** about 940 cameras, road-and-weather reports at passes, incidents (closures).
- **Key:** a subscription key from the [ODOT developer portal](https://apiportal.odot.state.or.us/)
  (`ORDOT_CODE_PRIMARY`, `ORDOT_CODE_SECONDARY`).
- **Their rules (portal terms, 2026-10-09):** credit the agency; **mirror** the pictures (download each one
  periodically and serve your own copy rather than sending visitors to ODOT); repeat ODOT's disclaimer.
- **What we do:** reports and incidents kept 2 minutes. Every ODOT camera is `mirror: true`: our server downloads it
  once per refresh period however many people look, and serves its copy from `/img`. We never keep past pictures
  (no replay, no before-and-after), since the terms cover one refreshed copy. The disclaimer is on the About page.

### Caltrans (California)

- **What for:** about 3,380 cameras, chain controls, full closures (lane-closure lists).
- **Key:** none ([cwwp2.dot.ca.gov](https://cwwp2.dot.ca.gov/)).
- **Their rules:** "There is no charge for the use of this data"; the site is public domain unless noted
  ([dot.ca.gov/conditions-of-use](https://dot.ca.gov/conditions-of-use)). No rate limit published.
- **What we do:** chain controls kept 5 minutes; the closure lists (several megabytes each) 10 minutes, and only for
  the mountain districts our passes are in.

### Idaho 511, Nevada 511 and UDOT Traffic (Idaho, Nevada, Utah)

The three run on the same system, with the same developer API and the same limit.

- **What for:** cameras; road-condition reports (with each state's chain or traction rule); events (full closures);
  road weather stations (summit temperature, pavement temperature).
- **Keys:** one per state, from each site's developer page: [Idaho 511](https://511.idaho.gov/developers/doc)
  (`ID_511_DOT_API_KEY`), [Nevada 511](https://www.nvroads.com/developers/doc) (`NV_511_DOT_API_KEY`),
  [UDOT Traffic](https://www.udottraffic.utah.gov/developers/doc) (`UT_511_DOT_API_KEY`).
- **Their rules:** "Throttling is enabled. Ten calls every 60 seconds." The API is offered so developers can
  "create mobile traffic apps". None of the three publishes terms for reusing the pictures. UDOT's
  [disclaimer](https://www.udottraffic.utah.gov/about/disclaimer): its information is published automatically,
  accuracy and timeliness can't be guaranteed, the site is watched only on weekday working hours, and a road listed
  as snowy or icy is no promise it has been plowed or salted; people rely on it at their own risk.
- **What we do:** three calls (road reports, events, weather stations) every five minutes per state, whoever is
  looking, with a hard stop at 8 a minute; after a failure (a bad key, the site down) we wait five minutes before
  trying again. Cameras are loaded once, by hand, with `scripts/import-511.mjs` (one call). Pictures load straight
  from each state's site, credited. Since 2026-10-22 the agency's own cameras near passes are in the replay, videos,
  before-and-afters and link previews too (no terms say no; we stop if a state asks), one picture every five
  minutes for about 155 cameras across the three states.
  Only the agency's own cameras are imported: the lists also carry other states' and private cameras.

## Cameras from others

### Windy.com Webcams API

- **What for:** ski area, lake, town and viewpoint cameras the road departments don't have.
- **Key:** `WINDY_API_KEY` from [api.windy.com](https://api.windy.com/keys).
- **Their rules ([terms](https://api.windy.com/webcams/terms)):** don't stretch images (original size or smaller);
  use only the image addresses the API gives; link every image to its Windy webcam page or player; show the courtesy
  line "Webcams provided by windy.com — add a webcam" near the cameras; use the API responsibly and don't load it
  heavily; use the data as delivered.
- **What we do:** each camera's picture address is asked for at most every 5 minutes; pictures show at Windy's size
  (400 px), link to Windy, and carry the courtesy line on every page that shows them. Never in previews or the replay.
  State road cameras that Windy relays, and fire-lookout cameras, are skipped (we take those from the source).

### National Park Service, USGS

- **What for:** park cameras (Rainier, Olympic, Yosemite, Crater Lake...), river cameras at stream gauges (HIVIS),
  Mount St. Helens.
- **Key:** none.
- **Their rules:** US government works, public domain unless noted; NPS appreciates credit
  ([nps.gov disclaimer](https://www.nps.gov/aboutus/disclaimer.htm)).
- **What we do:** credited on every picture; allowed in previews. NPS pictures are resized through our server.

### YouTube (scripts only)

- **What for:** finding live streams of public places (`scripts/find-youtube-cams.mjs` and the others); the page
  shows a stream with YouTube's own player.
- **Key:** `YOU_TUBE_DATA_API_KEY`, used only by those scripts, never by the site.
- **Their rules:** the [YouTube API Services Terms](https://developers.google.com/youtube/terms/api-services-terms-of-service)
  and a daily quota.
- **What we do:** streams play in YouTube's player (`youtube-nocookie.com`), unchanged; never in previews.

## Weather and snow

### National Weather Service (api.weather.gov)

- **What for:** forecasts at places and passes, weather warnings along a drive.
- **Key:** none. The [API page](https://www.weather.gov/documentation/services-web-api) asks for a User-Agent that
  identifies the app and a way to reach its maker; the rate limit is not published, and heavy use is blocked for a
  while.
- **What we do:** our User-Agent names the project's page. Forecast grid points kept a day, forecasts 10 minutes,
  warnings 3 minutes; at most 240 grid lookups a minute.

### Open-Meteo

- **What for:** forecasts for a time and height (the summit when you get there), "best time to cross", snowfall at
  ski areas, a backup place search.
- **Key:** none on the free plan.
- **Their rules ([terms](https://open-meteo.com/en/terms)):** fewer than 10,000 calls a day, 5,000 an hour and 600
  a minute; **non-commercial use only** (they give "websites or apps that have subscriptions or display
  advertisements" as commercial); data under CC BY 4.0, so credit is required. Voluntary donations are fine.
- **What we do:** at most 8,000 calls a day and 120 a minute; forecasts kept 10 to 30 minutes. Credited on the About
  page and next to the snow forecasts. **If the site ever shows ads or sells a subscription, it needs an
  Open-Meteo paid plan first.**

### USDA NRCS SNOTEL (AWDB)

- **What for:** snow depth and new snow at passes and ski areas.
- **Key:** none. US government data, public domain; no rate limit published.
- **What we do:** the station list once a day; each station's readings kept 30 minutes, asked for 20 stations to a request (it answers about four a second). Each reading links to its
  station page.

### avalanche.org

- **What for:** avalanche danger near passes.
- **Key:** none. Its public map layer publishes no terms.
- **What we do:** one call covers every forecast zone, kept 30 minutes. We show the rating with the forecast center's
  name, link to its full forecast, and say it is for the backcountry.

### NOAA (tides, buoys, river forecasts) and the FAA

- **What for:** tides and buoys at coast places, river levels, airport delays.
- **Key:** none. US government data; no rate limits published.
- **What we do:** airport status kept 2 minutes, river gauge details a day, tides and buoys about 10 minutes.

## Routes and place search

### OSRM demo server (routing.openstreetmap.de, run by FOSSGIS)

- **What for:** drive routes when Azure Maps isn't used, "Other ways", Powder day drive times.
- **Key:** none.
- **Their rules ([about](https://routing.openstreetmap.de/about.html)):** show the required attribution
  (OpenStreetMap) and a link to "fix the map"; send a valid User-Agent; one request a second at most; no scraping,
  no heavy use.
- **What we do:** at most 30 calls a minute (the "Other ways" share 15 of them), each route kept 10 minutes, drive
  time tables 30 minutes, and each visitor at most 20 new routes a minute. OpenStreetMap and OSRM are credited on the
  About page, with a "Fix the map" link.

### Nominatim (OpenStreetMap)

- **What for:** the second place search, when Photon finds nothing good.
- **Key:** none.
- **Their rules ([usage policy](https://operations.osmfoundation.org/policies/nominatim/)):** an absolute maximum of
  one request a second for the whole app; a User-Agent that identifies the app; visible attribution; cache results;
  no bulk or repeated identical requests.
- **What we do:** one lookup at a time, 1.1 seconds apart, at most a few waiting; every answer kept a day. Credited
  on the About page.

### Photon (Komoot)

- **What for:** place search and suggestions as you type.
- **Key:** none.
- **Their rules ([photon.komoot.io](https://photon.komoot.io/)):** "please be fair - extensive usage will be
  throttled"; no guarantee it stays up. OpenStreetMap data, so the OpenStreetMap credit applies.
- **What we do:** at most 120 calls a minute, answers kept an hour, and each visitor capped.

### Azure Maps

- **What for:** routes with live traffic, place search, weather along the way, when its key is set.
- **Key:** `AZURE_MAPS_KEY` (paid past small free monthly amounts).
- **Their rules:** Microsoft's product terms; the bill is ours.
- **What we do:** `src/lib/server/mapsBudget.ts` stops at 90% of each free monthly amount (1,000 routes, 5,000
  searches, 1,000 weather calls) and falls back to the free services; `/stats` shows the month's count. Local
  testing always runs without the key.

### US Census Bureau Gazetteer

- **What for:** the offline list of towns and ZIP codes (`scripts/build-gazetteer.mjs`).
- **Key:** none. Public domain; downloaded once a year by hand.

## Search engines

### IndexNow

- **What for:** telling Bing and others which pages changed (`scripts/indexnow.mjs`), run by hand.
- **Key:** our own key file served by the site, as the [protocol](https://www.indexnow.org/documentation) asks.

## Our own accounts

### Facebook Graph API (our Page)

- **What for:** the site's Facebook Page posts the snow by itself (`src/lib/server/autopost.ts`).
- **Key:** `FACEBOOK_PAGE_ID` and `FACEBOOK_PAGE_TOKEN` (a Page key from our own Meta app, which posts only to our
  own Page). Without them it only notes what it would post, on /stats.
- **What we do:** only a spot snowing now with 3 inches or more today; 4 AM to 8 PM Pacific; in each state at most 3
  posts a day, 2 hours apart (different states go out together); 10 a day in all; the same spot once in 3 days. The
  picture is the spot's link-preview picture, so only sources allowed in previews appear, each credited on it.

## Adding a source

1. Find its terms, rate limit and credit wording, and add a section here with the date you checked.
2. Keep calls well under its limit, cache answers, and send our User-Agent.
3. Credit it where its data shows and on the About page.
4. Pictures: no copies (previews, replay, videos) if its terms say no; a private owner needs to say yes.
5. Add a health check in `src/lib/server/health.ts` if the app depends on it.
