# Contributing to What's Up Ahead

Thanks for helping. You can contribute without writing any code, and nothing you do needs a password or API key.

## Ways to help

**1. Report a problem (no code).** Open an issue using one of the templates: a dead camera, a camera in the wrong place, a wrong label, or a bug.

**2. Add a camera, place or drive (data only).** Cameras are small JSON files in `data/cameras/`, checked against `schema/camera.schema.json`. Copy a similar file, change it, and open a pull request.

**3. Code.** The app is SvelteKit with TypeScript. Look for issues labeled `good first issue` or `help wanted`.

## The one rule for cameras: only feeds the owner publishes for public use

Add a camera only if its owner publishes it for public reuse: a government data feed (state DOT, National Park Service, NOAA, a state or county open-data program), or a service whose terms allow it. Do **not** add cameras that are private, belong to a business or TV station, or that you found by guessing a URL. Explain in your pull request where the feed comes from and why reuse is allowed. See [docs/sources.md](docs/sources.md) for what we already use. When in doubt, open an issue first.

Submit new cameras with `"status": "pending"`. The app only shows `approved` cameras; a maintainer flips it to `approved` after checking the source.

## Adding a camera

1. Find an existing file for a similar camera in `data/cameras/` and copy it. The file name must equal its `id` (lowercase letters, numbers and hyphens).
2. Fill in `name`, `lat` and `lon` (decimal degrees; latitude first), `feed_url` (must be `https`, and a direct picture), `feed_type`, `source`, `page_url`, `attribution_text`, `status: "pending"` and `created_at`.
3. Run `npm test`. It checks your file against the schema and checks that coordinates make sense and the picture address is unique.
4. Open a pull request. Describe the source and its terms.

Other kinds of data (`places`, `drives`, `weather-sources`, `passes`, `collections`) work the same way. [docs/data-model.md](docs/data-model.md) explains each one.

## Working on code

```
npm install
npm run dev          # no keys needed
npm run check        # type check
npm run lint         # formatting (npx prettier --write . to fix)
npm test             # unit tests and data checks
```

Some features use free API keys (WSDOT, ODOT, Windy). You do not need them: those parts show "unavailable" locally, and CI never has them. If you want them, copy `.env.example` to `.env`. Never commit `.env`.

Keep changes small and focused. Add or update a test when you change behavior. Camera data stays in `data/`, never hard-coded in the app.

## How your contribution is kept safe

- **Pull requests run checks without any secrets.** GitHub does not give secrets to pull requests from forks, and the checks only read the repository.
- **Data is validated automatically.** Every file is checked against its schema, and the checks also catch swapped coordinates, non-https addresses, duplicates and broken references.
- **Nothing goes live until a maintainer merges it.** The `main` branch needs a passing check and an owner review, and `main` is what the live site deploys.
- **Please do not** add tracking, ads, analytics, accounts, or code that fetches arbitrary addresses a visitor provides. The app only fetches addresses that come from our own data files.

## Reporting a security problem

Please do not open a public issue. See [SECURITY.md](SECURITY.md).

## How this was written

Most of the first version was written with an AI coding assistant, directed by voice. Contributions from people, AI-assisted or not, are welcome on the same terms: you are responsible for what you submit, and it has to pass the checks and review.

## Behavior

Be kind and assume good faith. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Adding a YouTube live stream

Run `node scripts/add-youtube-camera.mjs <link> --lat <lat> --lon <lon> --source "Owner" --use-channel`. It checks that the video can be embedded and is live, shows the channel owner, and with `--write` creates a `pending` camera file. Only use the owner's own channel. See https://whatsupahead.com/contribute.
