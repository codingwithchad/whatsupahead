# What's Up Ahead

**Cameras, weather and waits along your way, for Washington, Oregon, California, Idaho and Nevada.** The public cameras, forecasts, pass conditions and ferry, border and airport waits for the place you're headed, or for the whole drive. Works on iPhone and Android in the browser, nothing to install, free, no accounts.

**Try it: https://whatsupahead.com**

## What it does

- **Trip mode:** enter a start and a finish and see the cameras along the road in the order you'll pass them, with the forecast for when you'll arrive. "Follow my trip" hides cameras you've already passed.
- **Mountain passes:** open, chains or closed for passes in Washington (WSDOT), Oregon (ODOT), California (Caltrans chain controls), Idaho (ITD road reports) and Nevada (NDOT chain controls), plus a replay of the last two hours of each pass camera so you can see snow building up, and a before-and-after from up to six hours back that you can share ("6 AM bare, 9 AM snow").
- **Places:** ferries (with sailing space), border crossings (with wait times), airports (with FAA delays), airfields, national parks, ski areas, and any town or zip code.
- **Share:** every camera, place, list and drive has a Share button, and a shared link shows a preview picture: the camera's latest view (from public agencies whose pictures may be reused, credited), a place's cameras, or the drive on a map with the passes on the way.
- **Cameras are data, not code.** Adding one is a small JSON file, so you don't need to write any code to help.

It covers Washington, Oregon, California, Idaho and Nevada (about 7,600 cameras). The design (data files plus small adapters) is meant to grow to other states.

## Help wanted

You don't need to be a programmer. See [CONTRIBUTING.md](CONTRIBUTING.md). Easy ways in:

- Report a camera that's dead, mislabeled or in the wrong place.
- Add a camera, place or drive as a data file (no code, checked automatically).
- Pick up a [good first issue](../../labels/good%20first%20issue).

## Run it yourself

```
npm install
npm run dev        # http://localhost:5173, no keys needed
npm test           # unit tests and the data checks
npm run check      # type check
```

Some live data needs free keys (WSDOT, ODOT TripCheck, Windy and others). Copy `.env.example` to `.env` and fill in the ones you want; everything else works without them. To run your own copy on a server, see [docs/deploy.md](docs/deploy.md).

## How it's built

SvelteKit and TypeScript on one small Node server, which runs on any host that runs Node and keeps a little on disk (visit counts, the camera replay and shared before-and-afters; see [docs/deploy.md](docs/deploy.md)). Cameras, places, drives, passes and weather sources live in `data/`, each file checked against a schema in `schema/`. See [docs/data-model.md](docs/data-model.md), [docs/decisions.md](docs/decisions.md) and [docs/sources.md](docs/sources.md) (where each camera feed comes from and why we're allowed to use it).

## About this project

Built in October 2026 by one person with voice dictation and [Claude Code](https://claude.com/claude-code). It's a prototype and it's open source, and it would be better with other people in it.

## License

MIT. See [LICENSE](LICENSE). Camera pictures belong to their owners; this project only links to feeds their owners publish for public use, and puts pictures in link previews only where the owner allows it ([docs/sources.md](docs/sources.md)). The Inter font in `src/lib/server/fonts` is under the SIL Open Font License ([OFL.txt](src/lib/server/fonts/OFL.txt)).
