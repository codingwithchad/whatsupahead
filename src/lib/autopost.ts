import { clockWithDay } from './format';
import type { PassReport, PassStatus } from './passes';
import { REGIONS } from './regions';
import type { SnowingSpot } from './snowing';

/**
 * What a post is about: snow falling at a spot, a pass's chain rules changing, or snow on the way for a popular
 * drive (with its best time to cross). Each has its own limits.
 */
export type PostKind = 'snow' | 'chains' | 'forecast';

/** One post to the site's Facebook Page, or one it would have made (a dry run, before the Page's key is set). */
export interface PostEntry {
	/** The spot, pass or drive (`chains:WA` for a post about several passes). */
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

// ---- Snow on the way for a drive -----------------------------------------------------------------------------

/** A popular drive with snow forecast at a summit on the way in the next day, and when to leave to miss it. */
export interface DriveOutlook {
	id: string;
	name: string;
	state: string | null;
	href: string;
	/** The snowiest pass on the way, its preview picture, and its summit's height (where the forecast is for). */
	pass: string;
	preview: string;
	feet: number | null;
	/** Snow forecast at that summit, in inches, and when it starts. */
	inches: number;
	from: number;
	leaveBefore: number | null;
	leaveAfter: number | null;
	timeZone: string;
}

/** Enough forecast snow for a drive to be worth a post. */
const FORECAST_INCHES = 2;
/** "Leave before" must leave time to read the post and go. */
const LEAD = 2 * HOUR;
/** Promoting "Best time to cross" without overdoing it: one drive a day in each state, the same drive every 3 days. */
const SAME_DRIVE = 3 * 24 * HOUR;
const FORECAST_SPACING = 24 * HOUR;

const useful = (o: DriveOutlook, now: number) =>
	o.inches >= FORECAST_INCHES &&
	((o.leaveBefore !== null && o.leaveBefore - now >= LEAD) || o.leaveAfter !== null);

/** The drives to post about now, at most one a state, `outlooks` in the drives' own order (most looked up first). */
export function pickForecasts(
	outlooks: DriveOutlook[],
	all: PostEntry[],
	now: number
): DriveOutlook[] {
	const log = ofKind(all, 'forecast');
	const posted = new Set(log.filter((e) => !e.error && now - e.at < SAME_DRIVE).map((e) => e.id));
	// A failed try waits two hours, like a snow post.
	const busy = (state: string) =>
		log.some((e) => e.state === state && now - e.at < (e.error ? SPACING : FORECAST_SPACING));
	const out: DriveOutlook[] = [];
	for (const o of outlooks) {
		const state = o.state ?? o.id;
		if (!useful(o, now) || posted.has(o.id) || busy(state)) continue;
		if (out.some((x) => (x.state ?? x.id) === state)) continue;
		out.push(o);
	}
	return out;
}

/** "Snow forecast at Snoqualmie Pass from about 9 PM: ... leave before 7:45 PM ...", with the drive's link. */
export function forecastText(
	o: DriveOutlook,
	origin: string,
	ref?: string,
	now = Date.now()
): string {
	const when = (t: number) => clockWithDay(t, now, o.timeZone);
	const height = o.feet ? ` (${o.feet.toLocaleString('en-US')} ft)` : '';
	const before = o.leaveBefore !== null && o.leaveBefore - now >= LEAD ? o.leaveBefore : null;
	const advice =
		before !== null && o.leaveAfter !== null
			? `leave before ${when(before)} to cross ahead of it, or after ${when(o.leaveAfter)} once it has passed`
			: before !== null
				? `leave before ${when(before)} to cross ahead of it`
				: `leave after ${when(o.leaveAfter!)}, once it has passed (plows need time too)`;
	return [
		`Snow forecast at ${o.pass} from about ${when(o.from)}: about ${Math.round(o.inches)} in at the summit${height}.`,
		`${o.name}: ${advice}.`,
		`Best time to cross, hour by hour: ${origin}${linkWith(o.href, ref)}`
	].join(' ');
}

/** The log, newest last, keeping the last two weeks. */
export function keepRecent(log: PostEntry[], now: number): PostEntry[] {
	return log.filter((e) => now - e.at < 14 * 24 * HOUR).sort((a, b) => a.at - b.at);
}
