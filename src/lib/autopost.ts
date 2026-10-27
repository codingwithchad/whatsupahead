import { clockWithDay } from './format';
import type { PassReport, PassStatus } from './passes';
import { REGIONS } from './regions';
import type { SnowingSpot } from './snowing';

/**
 * What a post is about: snow falling at a spot, a pass's chain rules changing, or snow on the way over the passes
 * (with the best time to cross each). Each has its own limits.
 */
export type PostKind = 'snow' | 'chains' | 'forecast';

/** One post to the site's Facebook Page, or one it would have made (a dry run, before the Page's key is set). */
export interface PostEntry {
	/** The spot or pass (`chains:WA`, `forecast:WA` for a post about several passes). */
	id: string;
	name: string;
	/** Missing on the first posts, which were all snow. */
	kind?: PostKind;
	/** The spot's state ("WA"), as each state has its own spacing and daily limit. */
	state?: string | null;
	at: number;
	text: string;
	/** Facebook's id for the post, when it went up. */
	post: string | null;
	dry: boolean;
	error?: string;
}

const HOUR = 3600_000;
const kindOf = (e: PostEntry): PostKind => e.kind ?? 'snow';
const ofKind = (log: PostEntry[], kind: PostKind) => log.filter((e) => kindOf(e) === kind);
const linkWith = (href: string, ref?: string) =>
	ref ? `${href}${href.includes('?') ? '&' : '?'}ref=${ref}` : href;

// ---- Snow falling now ----------------------------------------------------------------------------------------

/** The Page should read like people watching the mountains, not a feed: a few posts a day for each state. */
const PER_STATE_PER_DAY = 3;
export const MAX_PER_DAY = 10;
/** Posts in one state at least this far apart; different states go out together. */
const SPACING = 2 * HOUR;
/** The same spot again only after this long: a storm lasts days. */
const SAME_SPOT = 3 * 24 * HOUR;
/**
 * New snow today before a spot is posted: with an inch or two, the cameras (often lower than the gauge, or in fog)
 * show wet pavement under a line that says snowing.
 */
const POST_INCHES = 3;

/**
 * The spots to post about now, at any hour, at most one a state: each snowing now with 3 inches or more today and its
 * own camera pictures, not posted about in three days. A state's posts are two hours apart and three a day, and ten
 * a day in all. Dry runs and failed tries count too, so a dry run shows what would really go up and a failing post
 * isn't retried every half hour. `spots` comes snowing now first, most snow first.
 */
export function pickPosts(spots: SnowingSpot[], all: PostEntry[], now: number): SnowingSpot[] {
	const log = ofKind(all, 'snow');
	const day = log.filter((e) => now - e.at < 24 * HOUR && !e.error);
	const posted = new Set(log.filter((e) => !e.error && now - e.at < SAME_SPOT).map((e) => e.id));
	const today = (s: SnowingSpot) => Math.max(s.sinceSix ?? 0, s.change24 ?? 0);
	const stateOf = (s: SnowingSpot) => s.state ?? s.id;
	const busy = (state: string) =>
		log.some((e) => e.state === state && now - e.at < SPACING) ||
		day.filter((e) => e.state === state).length >= PER_STATE_PER_DAY;
	const out: SnowingSpot[] = [];
	for (const s of spots) {
		if (day.length + out.length >= MAX_PER_DAY) break;
		const state = stateOf(s);
		if (!s.now || !s.pictured || today(s) < POST_INCHES || posted.has(s.id)) continue;
		if (busy(state) || out.some((o) => stateOf(o) === state)) continue;
		out.push(s);
	}
	return out;
}

// ---- Chain rules changing ------------------------------------------------------------------------------------

/** The rules a chain post is about. Closures and "no report" are left to the pass pages. */
export type Rule = Extract<PassStatus, 'chains' | 'traction' | 'open'>;
const RULES: Rule[] = ['chains', 'traction', 'open'];

/** What we last posted about a pass, and what its report says lately (since when). */
export interface PassMemory {
	posted: Rule;
	seen: Rule;
	since: number;
	/** The last time its report gave a rule. */
	read?: number;
}

export interface ChainChange {
	id: string;
	name: string;
	route: string;
	/** The pass's place, for its preview picture. */
	place: string;
	state: string | null;
	from: Rule;
	to: Rule;
	report: PassReport;
}

/** A new rule must hold this long (two checks half an hour apart), so a report fixed a minute later isn't posted. */
const STEADY = 25 * 60_000;
/**
 * A pass with no rule this long (reports over for the season, or closed for days) starts again from what its report
 * says, so the first report next winter isn't posted as a change from last spring.
 */
const FORGET = 3 * 24 * HOUR;
/** One chain post an hour in a state, with every pass that changed in it; eight a day. */
const CHAIN_SPACING = HOUR;
const CHAINS_PER_STATE_PER_DAY = 8;

/**
 * The passes whose chain rules changed from what was last posted and have held for half an hour. `memory` is
 * updated in place (except `posted`, set once the post goes up). A pass seen for the first time (or after days
 * without a rule) is only remembered, so a deploy doesn't post every pass.
 */
export function chainChanges(
	passes: { id: string; name: string; route: string; place: string; state: string | null }[],
	reports: Map<string, PassReport>,
	memory: Record<string, PassMemory>,
	now: number
): ChainChange[] {
	const out: ChainChange[] = [];
	for (const p of passes) {
		const report = reports.get(p.id);
		const rule = RULES.find((r) => r === report?.status);
		if (!report || !rule) continue;
		const m = memory[p.id];
		if (!m || now - (m.read ?? m.since) > FORGET) {
			memory[p.id] = { posted: rule, seen: rule, since: now, read: now };
			continue;
		}
		m.read = now;
		if (m.seen !== rule) {
			m.seen = rule;
			m.since = now;
		}
		if (rule !== m.posted && now - m.since >= STEADY)
			out.push({ ...p, from: m.posted, to: rule, report });
	}
	return out;
}

/**
 * The chain posts to make now: one for each state with changes, unless the state had one in the last hour (its
 * changes wait, and one that flips back before then is never posted). Chains first.
 */
export function pickChains(changes: ChainChange[], all: PostEntry[], now: number): ChainChange[][] {
	const log = ofKind(all, 'chains');
	const busy = (state: string) =>
		log.some((e) => e.state === state && now - e.at < CHAIN_SPACING) ||
		log.filter((e) => e.state === state && !e.error && now - e.at < 24 * HOUR).length >=
			CHAINS_PER_STATE_PER_DAY;
	const states = [...new Set(changes.map((c) => c.state ?? c.id))];
	return states
		.filter((s) => !busy(s))
		.map((s) =>
			changes
				.filter((c) => (c.state ?? c.id) === s)
				.sort((a, b) => RULES.indexOf(a.to) - RULES.indexOf(b.to))
		);
}

const RULE_WORDS: Record<Rule, string> = {
	chains: 'chains required',
	traction: 'traction tires advised',
	open: 'no restrictions'
};
const sentence = (s: string) => s.trim().replace(/[.\s]+$/, '');

/** A post about one state's chain changes, ending with the link to the pass (or the state's passes). */
export function chainText(changes: ChainChange[], origin: string, ref?: string): string {
	if (changes.length === 1) {
		const c = changes[0];
		const rules = c.report.restrictions
			.filter((r) => !/^no restrictions/i.test(r.text))
			.map((r) => (r.direction ? `${r.direction}: ${sentence(r.text)}.` : `${sentence(r.text)}.`));
		return [
			`${c.name} (${c.route}): ${RULE_WORDS[c.to]} now, was ${RULE_WORDS[c.from]}.`,
			...rules,
			`Cameras, chains for your car and the pass report: ${origin}${linkWith(`/passes/${encodeURIComponent(c.id)}`, ref)}`
		].join(' ');
	}
	const region = REGIONS.find((r) => r.abbr === changes[0].state);
	const list = changes.map((c) => `${c.name}, ${RULE_WORDS[c.to]} (was ${RULE_WORDS[c.from]})`);
	const where = region ? `/passes?in=${region.name.toLowerCase().replace(/\s+/g, '-')}` : '/passes';
	return `${region ? `${region.name} passes` : 'Passes'} now: ${list.join('; ')}. Cameras and chains for your car on every pass: ${origin}${linkWith(where, ref)}`;
}

// ---- Snow on the way over the passes -------------------------------------------------------------------------

/** A pass with snow forecast at its summit in the next day, and when to cross to miss it. */
export interface PassOutlook {
	id: string;
	name: string;
	state: string | null;
	href: string;
	preview: string;
	/** The summit's height, where the forecast is for (the road's height: drivers' snow). */
	feet: number | null;
	/** The road ends up there (Mt. Baker Highway): drive up, not across. */
	deadEnd?: boolean;
	/** Snow forecast at the summit, in inches, and when it starts. */
	inches: number;
	from: number;
	/** Be over the summit before this to get ahead of the snow, or after this once it has passed. */
	crossBefore: number | null;
	crossAfter: number | null;
	timeZone: string;
}

/** Enough forecast snow at a summit for a pass to be in a post. */
const FORECAST_INCHES = 2;
/** "Cross before" must leave time to read the post and get there. */
const LEAD = 2 * HOUR;
/**
 * Promoting "Best time to cross" without overdoing it: one post a day in each state, naming its snowiest passes
 * (people ask about the pass they're crossing: Stevens on Thursday, Snoqualmie Saturday).
 */
const FORECAST_SPACING = 24 * HOUR;
const PASSES_PER_POST = 4;

/** The posts to make now: for each state not posted today, its passes with 2 inches or more coming, snowiest first. */
export function pickForecasts(
	outlooks: PassOutlook[],
	all: PostEntry[],
	now: number
): PassOutlook[][] {
	const log = ofKind(all, 'forecast');
	// A failed try waits two hours, like a snow post.
	const busy = (state: string) =>
		log.some((e) => e.state === state && now - e.at < (e.error ? SPACING : FORECAST_SPACING));
	const snowy = outlooks
		.filter((o) => o.inches >= FORECAST_INCHES)
		.sort((a, b) => b.inches - a.inches || a.name.localeCompare(b.name));
	const states = [...new Set(snowy.map((o) => o.state ?? o.id))].filter((s) => !busy(s));
	return states.map((s) => snowy.filter((o) => (o.state ?? o.id) === s).slice(0, PASSES_PER_POST));
}

/** "Cross before 9:45 PM to get ahead of it, or after 10:00 AM tomorrow once it has passed." */
function crossWords(o: PassOutlook, now: number): string {
	const when = (t: number) => clockWithDay(t, now, o.timeZone);
	const go = o.deadEnd ? 'Drive up' : 'Cross';
	const before = o.crossBefore !== null && o.crossBefore - now >= LEAD ? o.crossBefore : null;
	if (before !== null && o.crossAfter !== null)
		return `${go} before ${when(before)} to get ahead of it, or after ${when(o.crossAfter)} once it has passed.`;
	if (before !== null) return `${go} before ${when(before)} to get ahead of it.`;
	if (o.crossAfter !== null)
		return `${go} after ${when(o.crossAfter)}, once it has passed (plows need time too).`;
	return 'It keeps on through the next day: go prepared.';
}

const snowLine = (o: PassOutlook, now: number) =>
	`about ${Math.round(o.inches)} in at ${o.deadEnd ? 'the top of the road' : 'the summit'}${o.feet ? ` (${o.feet.toLocaleString('en-US')} ft)` : ''} from about ${clockWithDay(o.from, now, o.timeZone)}`;

/** A post about the snow coming to one state's passes, each with when to cross and its link. */
export function forecastText(
	passes: PassOutlook[],
	origin: string,
	ref?: string,
	now = Date.now()
): string {
	const link = (o: PassOutlook) => `${origin}${linkWith(o.href, ref)}`;
	if (passes.length === 1) {
		const o = passes[0];
		return `Snow on the way at ${o.name}: ${snowLine(o, now)}. ${crossWords(o, now)} Cameras, chains for your car and the best time to ${o.deadEnd ? 'drive up' : 'cross'}, hour by hour: ${link(o)}`;
	}
	const region = REGIONS.find((r) => r.abbr === passes[0].state);
	return [
		`Snow on the way in the ${region ? `${region.name} ` : ''}mountains. When to go, hour by hour:`,
		...passes.map((o) => `${o.name}: ${snowLine(o, now)}. ${crossWords(o, now)} ${link(o)}`)
	].join('\n\n');
}

/** The log, newest last, keeping the last two weeks. */
export function keepRecent(log: PostEntry[], now: number): PostEntry[] {
	return log.filter((e) => now - e.at < 14 * 24 * HOUR).sort((a, b) => a.at - b.at);
}
