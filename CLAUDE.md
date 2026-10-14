# What's Up Ahead: notes for Claude

Public cameras, weather and pass reports around a place and along a drive, for Washington, Oregon, California,
Idaho and Nevada. A SvelteKit web app (no install, no accounts) at whatsupahead.com. Free today; never promise "always free" or
"no ads" anywhere (the owner may need ads or sponsors to pay for servers one day).

## Start of every session: catch up before suggesting anything

1. Read `CLAUDE.local.md` if it exists (private notes: hosting, where we left off, open threads).
2. Run `git log --oneline -15` and read the last few entries of `docs/decisions.md`.
3. Give the user a 3 to 5 line summary of where things stand and what was next, then ask what they want to do.
   Don't propose new features until you have done this and looked at the relevant code.

At the end of a session, when the user says they're wrapping up: update "Where we left off" in `CLAUDE.local.md`.

## Working with the user

- The user is one-handed and works by voice dictation. They can type a short command, a variable name or an
  env name, nothing longer. Claude writes all the code and runs the commands; when the user must run one
  (a login, a vault write), give a single line they can paste with `!`.
- Keep replies short and plain, and offer choices they can answer in a word.
- Read dictation charitably: words arrive as sound-alikes ("bear" for bare, "Clayolum" for Cle Elum) and
  background TV sometimes lands in a message. Ask only when a misheard word would change the meaning.
- Commit straight to `main` when a change is done and checked (the owner pushes past branch protection).

## Commands

|                                        |                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Install                                | `npm ci`                                                                                                              |
| Checks (all must pass before a commit) | `npm run lint`, `npm run check`, `npm test`                                                                           |
| Format                                 | `npx prettier --write <paths>`                                                                                        |
| Build and run locally                  | `npm run build`, then `AZURE_MAPS_KEY= PORT=3311 node --env-file=.env build` (or the key runner in `CLAUDE.local.md`) |

Local testing: always run with `AZURE_MAPS_KEY=` (empty) so routes, search and weather use the free services;
Azure Maps is paid past small free amounts. Stop a local server by its port, never with a broad `pkill`.
Check layouts at phone width (390 px) with headless Chromium (playwright-core in the session scratchpad).

## Where things are

- `data/`: everything the app shows is data, one JSON file each, in per-state folders (`us-wa`, `us-or`,
  `us-ca`): `cameras`, `places`, `collections`, `passes`, `weather-sources`, `drives`, `gazetteer`, and
  `regions.json`. Checked against `schema/` by `src/lib/server/data.test.ts` (file name = id, ids unique).
- `src/routes/`: pages (`search` is a place page, `trip`, `passes`, `collections/[id]`, `cameras/[id]`,
  `moments/[id]`), `og/*` (link-preview pictures), `api/*`, `img/[id]` (our copy of pictures that need one).
- `src/lib/server/`: outside sources and caching (`conditions.ts`, `passes.ts`, `routing.ts`, `geocode.ts`,
  `azureMaps.ts` + `mapsBudget.ts`, `history.ts` replay, `moments.ts`, `shareCard.ts`, `stats.ts`).
- `scripts/`: importers (`import-caltrans.mjs`, `import-tripcheck.mjs`, `import-wsdot-route.mjs`,
  `import-windy.mjs`, ...).
- `docs/`: `decisions.md` (why things are the way they are, newest last), `data-model.md`, `sources.md`
  (every source's terms), `deploy.md` (running your own copy).

## Rules

- Respect each camera source's terms (`docs/sources.md`). Windy pictures: unchanged, linked, never enlarged.
  ODOT: serve our own copy (`mirror`), never keep past ones. WSDOT: credit "Camera courtesy of WSDOT", never call
  a picture "live" (only real video streams are live), go easy on its servers. Link previews: only sources in
  `src/lib/sharing.ts`.
  Ask before adding fire-lookout cameras.
- Never print, commit or put on a command line any key or secret. Keys live outside the repository: a gitignored `.env`
  for your own copy; where this project's own keys live is in `CLAUDE.local.md`.
- This repository is public: keep hosting-provider and sponsor details out of it (they go in
  `CLAUDE.local.md` or the gitignored `ops/` folder).
- Visit counting stays cookieless and anonymous. The one cookie: "Don't count this device" on `/stats` (holds
  no id, set only when someone taps it), for testing on our own phones.
- Follow mode (the drive page while following) is read in a moving car: never put sponsors, ads or promotions
  there, whatever else the site ever carries.
- Write user-facing text and docs in plain words; match the surrounding code's style and comment density.
