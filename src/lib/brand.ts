import { REGIONS } from './regions';

/** The app's name and wording, in one place so a rename touches one file. */
export const APP_NAME = "What's Up Ahead";
export const APP_SHORT = 'Up Ahead';
export const TAGLINE = 'Cameras, weather and waits along your way.';
/** Where the app works, from data/regions.json, so adding a state updates every mention. */
const states = REGIONS.map((r) => r.name);
export const COVERAGE =
	states.length > 1 ? `${states.slice(0, -1).join(', ')} and ${states.at(-1)}` : states[0];
export const COVERAGE_SHORT = states.join(' · ');
/** One sentence for descriptions and link previews. */
export const WHERE = `For ${COVERAGE}.`;
export const REPO_URL = 'https://github.com/codingwithchad/whatsupahead';
