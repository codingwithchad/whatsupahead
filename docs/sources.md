# Camera sources and usage rights

Checked 2026-10-07. Rule: use a camera only if its owner publishes it for public reuse (government data, or an API whose terms allow it). Everything else needs the owner's permission first.

## In use

| Source | Cameras | Basis |
|---|---|---|
| WSDOT (highway, pass, ferry, border cameras via the Traveler Information API) | most of the data | Public agency data, used through its official API with an access code. A few cameras in WSDOT's feed belong to others (City of Seattle, Sun Mountain Lodge, a customs broker, Lewiscounty.com); WSDOT's feed names the owner, and we credit that owner "via WSDOT" and link to them. WSDOT can't give permission for these (2026-10-13); they stay up unless an owner asks us to take theirs down. Whidbey Telecom's four Clinton cameras were removed and `scripts/import-wsdot-route.mjs` skips them |
| Oregon DOT TripCheck (CCTV inventory through the TripCheck Data API) | about 940 Oregon road cameras, `data/cameras/us-or/odot-*` | Public agency data through ODOT's official API with a subscription key; cameras may belong to ODOT or partner agencies (cities, counties). ODOT Developer Portal terms (subscription 2026-10-09): (a) credit the agency, (b) mirror: our server downloads each picture periodically and serves its own copy (`mirror: true`, served by /img), (c) repeat ODOT's disclaimer (on the About page) |
| Caltrans (CWWP2 open data, one camera list per district; `scripts/import-caltrans.mjs`, no key) | about 3,380 California road cameras, `data/cameras/us-ca/caltrans-*` | Caltrans: "There is no charge for the use of this data"; its site is public domain unless noted (dot.ca.gov/conditions-of-use). Pictures load straight from Caltrans (they allow it from any site); we credit Caltrans and link QuickMap |
| Idaho Transportation Department, Idaho 511 (developer API with a key; `scripts/import-511.mjs idaho`) | about 590 Idaho road and road-weather cameras, `data/cameras/us-id/itd-*`, and the Ada County Highway District's Boise cameras (`achd-*`, credited "via Idaho 511") | Public agency data through Idaho 511's developer API, which ITD offers so developers can build traffic apps. Idaho 511 publishes no terms of use for the pictures, so they are shown straight from Idaho 511 with credit, and left out of the replay, before-and-afters and link previews until ITD says otherwise. Idaho 511 also lists other states' and private cameras; those are not imported. The API allows ten calls a minute: the app makes three every five minutes |
| Nevada Department of Transportation, Nevada 511 (nvroads.com developer API with a key; `scripts/import-511.mjs nevada`) | about 580 Nevada road cameras, `data/cameras/us-nv/ndot-*` (Reno, Lake Tahoe's Nevada side, Carson City, Las Vegas, I-80) | Public agency data through Nevada 511's developer API, offered so developers can build traffic apps; the same system as Idaho 511. Nevada 511 publishes no terms for reusing the pictures, so they are shown straight from Nevada 511 with credit and left out of the replay, before-and-afters and link previews until NDOT says otherwise. Cameras with no named owner ("USER") are not imported. Ten calls a minute: the app makes three every five minutes |
| WSDOT Aviation (about 90 airfield cameras across Washington) | `airfields` collection | Same WSDOT feed and terms. WSDOT notes the pictures are for pilots, not an official weather briefing |
| National Park Service (Mount Rainier Paradise and Longmire, Olympic Hurricane Ridge and Lake Crescent, North Cascades Newhalem; Crater Lake and John Day Fossil Beds in Oregon; Yosemite, Sequoia, Joshua Tree, Lassen, Redwood and Whiskeytown in California) | 25 live cameras, 2 seasonal (Sunrise, down for the winter) | NPS content is generally public domain unless noted; credit appreciated (nps.gov/aboutus/disclaimer.htm). Served resized through our server |
| Windy.com Webcams API | resort, Westport, Lake Wenatchee, AlertWest, airport cameras | Free API tier; their terms: use API image links unchanged, link each image to Windy (whose page is the full view), credit Windy, never show an image larger than Windy provides (400 px). Cards open our viewer like every other camera, with a "Full size on Windy" link under the picture; in the viewer the picture itself links to Windy and stays at 400 px |
| USGS river cameras (HIVIS, via the National Imagery Management System API; `scripts/import-usgs-cameras.mjs`) | about 25 streamgage cameras in Washington and Oregon (Skagit, Nooksack, Cowlitz, Sandy, McKenzie, Rogue...) | US government imagery, public domain for the most part; each camera links to its streamgage page with the water-level graph |
| USGS Cascades Volcano Observatory | Mount St. Helens from Johnston Ridge | Public domain (USGS) |
| Pass reports outside Washington (data, not cameras; `data/passes/us-or`, `us-ca`, `us-id`, `us-nv`) | Oregon: ODOT crew road-and-weather reports and closures (TripCheck API `/RW/Reports`, `/Incidents`, same key and terms as the cameras). California: Caltrans chain controls and full closures (CWWP2 `cc` and `lcs` lists, open data) Idaho: ITD crew road-condition reports for the stretch over each pass, Idaho 511 events (full closures, any chain requirement) and the summit road weather station (Idaho 511 API `winterroads`, `event`, `weatherstations`). Nevada: NDOT's road-condition reports, which carry its chain controls in its own words (all of them listed at nvroads.com/about/definitions), Nevada 511 full closures, and the nearest weather station's temperature. | A pass's report is built from the reports on its highway near the summit (`report.route`, `radius_km`); see src/lib/passes.ts |
| Road surface temperature on a drive (data, not cameras) | WSDOT road weather stations (Traveler Information API `Scanweb`, same access code): the pavement sensors' temperature beside the road; in Idaho, ITD's road weather stations (Idaho 511 `weatherstations`) | Same WSDOT terms as the cameras; readings older than 2 hours are left out |
| Road closures on a drive (data, not cameras) | WSDOT Highway Alerts (same access code as the cameras; only alerts whose wording closes the whole road), ODOT incidents (closures), Caltrans full closures in the mountain districts we read for passes; Idaho 511 events marked as full closures, on state highways only; Nevada 511 events marked as full closures, on state highways only | Same terms as each state's camera and pass data above; see src/lib/roadAhead.ts |
| Snow depth at passes (data, not cameras) | USDA NRCS SNOTEL stations through the AWDB REST service (the station nearest a pass, within 10 miles and 2,000 feet of its height) | US government data, public domain; each reading links to its station page |
| Avalanche danger at passes (data, not cameras) | avalanche.org public map layer (one request covers every forecast zone: NWAC, Central Oregon, Sierra, Eastern Sierra, Mount Shasta) | Public API of the American Avalanche Association's site; we show the danger rating with the forecast center's name and link to its forecast, and say it is for the backcountry |
| NOAA / National Weather Service, FAA, USGS (data, not cameras) | forecasts, weather warnings along a drive (api.weather.gov `/alerts/active`, matched by forecast zone), river gauges, delays, tides, buoys | US government data |

## Link previews (shared links)

A shared link shows a picture our server makes (src/lib/server/shareCard.ts): the camera's latest picture, a few of a place's cameras, or the drive on a map. That picture is a copy, and the site showing the link (Facebook, a messaging app) keeps its own copy, so only some sources' pictures go in. The list is in src/lib/sharing.ts (checked 2026-10-12):

| Source | In previews | Why |
|---|---|---|
| Caltrans | Yes | Open data, public domain unless noted (dot.ca.gov/conditions-of-use) |
| National Park Service, USGS | Yes | US government works, public domain; credited |
| ODOT TripCheck | Yes | ODOT's terms ask republishers to serve their own copy and credit the agency, which a preview does |
| WSDOT | Yes, credited "Camera courtesy of WSDOT" | WSDOT agreed on 2026-10-13 (reply to our request through its feedback form), asking that we: credit each picture "Camera courtesy of WSDOT"; never call the pictures live (they are the latest picture, not a stream); go easy on its servers; and use only WSDOT's own cameras, not ones it passes on for others. It also noted that our use limits its ability to count how many people use its information |
| Cameras WSDOT passes on for others ("via WSDOT"), WSDOT Aviation | No | Owned by others (telecoms, cities, airports) |
| Windy.com | No | Terms: show the image unchanged, from Windy's link, linked to Windy; a preview would change and re-host it |
| YouTube streams, private owners | No | No reuse permission |

Every preview with a picture prints the owner's credit and the time it was made, and links back to the page that shows the camera's latest picture with the owner's credit and source link. A page whose cameras are all excluded still gets a card with its name and our logo. Previews are made at most once every 10 minutes per page.

A shared before-and-after (two pictures from a camera's replay, hours apart) keeps those two small pictures for 30 days so the link keeps working. Only cameras whose pictures may appear in previews can be shared this way, and the replay itself records only WSDOT, Caltrans and National Park Service cameras near passes (never ODOT, whose terms cover one refreshed copy, not past ones).

## Looked at, not used yet (2026-10-09)

- **WebCOOS** (NOAA-backed coastal cameras): API needs an account; only Ocean Shores is in our area.
- **AlertWest / ALERTWildfire / ALERTCalifornia** fire cameras: the Oregon Hazards Lab allows media use with credit; no stated terms for apps. Ask before adding more than the two that come through Windy (the California Windy sweep on 2026-10-11 left out 15 of them).
- **Ski resorts' own cameras** (Palisades, Mammoth, Kirkwood...): shown on the resorts' websites; each ski page links there. Mammoth's and China Peak's that Windy carries are included through Windy.
- **CamStreamer gallery**: its public streams are YouTube and Windy uploads, already reachable through those.
- **NWAC**: weather stations, no cameras of its own that we found.
- **USGS volcano cameras for Rainier, Baker, Hood**: no public picture link found (Rainier's views come from the Park Service).

## Looked at and not used (from the UW Atmospheric Sciences list, a.atmos.washington.edu/data/webcams.html)

The list is old: of 164 unique links, 66 respond and only 14 are direct image feeds.

- **Private and commercial** (Space Needle, TV stations, desticam, islandcam, resorts, hotels, wunderground users, personal sites): no reuse permission stated. Ask the owner first.
- **Public bodies with no stated licence** (Port of Edmonds, Port of Port Angeles, City of Lynden, Sno-Isle libraries, UW and WWU cameras): likely approachable by email, but not assumed.
- **US Forest Service visibility cameras** (fsvisimages.com): federal, but the site is a .com and states no terms. Check before using.
- **Outside Washington, Oregon, California, Idaho and Nevada** (BC, Montana, Utah, Arizona, Alaska): out of scope for now. To add a region, see docs/data-model.md, Regions.

## National parks in Washington

Checked every NPS unit page for webcams. Only three parks have them: Mount Rainier (Paradise, Longmire, an air-quality view, and two Sunrise cameras that NPS lists as down for the winter), Olympic (Hurricane Ridge parking lot and south view, and the Lake Crescent air-quality camera) and North Cascades (Newhalem air-quality camera). San Juan Island, Ebey's Landing, Lake Roosevelt, Fort Vancouver and the other units have none. The Kalaloch beach camera on Olympic's page is run by a concessionaire (pixelcaster.com), not NPS, so it is not used.

## Snoqualmie Pass

WSDOT cameras on I-90 from Seattle to the pass and east past Hyak to Stampede Pass, the WSDOT Aviation cameras at Hyak, three WSDOT roadside weather stations, the pass road-conditions report (seasonal, about Nov 1 to Apr 1) and an NWS forecast. The Summit at Snoqualmie publishes its mountain cameras only as video embeds on its own site (camstreamer.com), with no reuse terms, and Windy.com does not list them, so they are not used.

## Scenic views (Seattle and around)

Six cameras through the Windy.com Webcams API (credit and link rules apply): KOMO News (Columbia Center skyline), KING 5 (downtown and the Space Needle; Tacoma Dome with Mount Rainier), the City of Kirkland (Marina Park), Seattle Pacific University (Martin Square) and WASAR.org (Museum of Flight at Boeing Field). The pictures were checked by eye; Windy's labels and map positions are sometimes wrong, so only cameras that show what their name says were added. The National Park Service cameras and the Westport ocean view are tagged `scenic` too.

Not used: the University of Washington's Red Square camera and the other UW campus cameras (washington.edu/cambots) are public but state no reuse terms; Seattle Waterfront and Space Needle webcams are private businesses; some Windy entries are private home or business cameras.
