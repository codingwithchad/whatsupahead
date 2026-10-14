import type { PassReport } from './passes';
import type { RoadWarnings } from './roadAhead';
import { FREEZING_F } from './roadSurface';
import type { StopWeather } from './routeWeather';
import { passAnswer, type Need, type Vehicle } from './vehicle';

// The answer to "am I OK to go?" in one glance: a colour, a few words, one sentence and a handful of facts.
// Everything comes from what the page already has; the details stay one tap away.

export type Level = 'go' | 'ready' | 'stop' | 'unknown';

export interface Fact {
	icon: 'pass' | 'chains' | 'temp' | 'snow' | 'ice' | 'warning' | 'closed' | 'clock';
	text: string;
	tone: Level;
}

export interface Verdict {
	level: Level;
	/** "Looks good", "Go prepared", "Not now", "Check before you go". */
	title: string;
	/** One plain sentence with the main reason. */
	sentence: string;
	facts: Fact[];
}

export const TITLES: Record<Level, string> = {
	go: 'Looks good',
	ready: 'Go prepared',
	stop: 'Not now',
	unknown: 'Check before you go'
};

const ORDER: Level[] = ['stop', 'ready', 'unknown', 'go'];
const worst = (a: Level, b: Level) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);
// Lower-case the first letter for the middle of a sentence, but not in a short form like "AWD" or "SR 20".
const lower = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const NEED_LEVEL: Record<Need, Level> = {
	closed: 'stop',
	chains: 'ready',
	tires: 'ready',
	carry: 'go',
	ok: 'go',
	unknown: 'unknown'
};

export interface DriveInput {
	avoided: { closed: string; instead: string; extraMinutes: number }[];
	blocked: string[];
	passes: { name: string; report: PassReport | null; heading: number | null }[];
	/** Null while still loading. */
	warnings: RoadWarnings | null;
	/** The forecast stops still ahead, null while loading. */
	weather: StopWeather[] | null;
	vehicle: Vehicle | null;
	/** Formats a time ("7:10 PM") for a stop. */
	clock?: (s: StopWeather) => string;
}

/** The drive in one glance. */
export function driveVerdict(d: DriveInput): Verdict {
	let level: Level = 'go';
	const reasons: string[] = [];
	const facts: Fact[] = [];
	const add = (l: Level, reason: string | null, fact?: Fact) => {
		level = worst(level, l);
		if (reason) reasons.push(reason);
		if (fact) facts.push(fact);
	};

	for (const name of d.blocked)
		add('stop', `${name} is closed and there's no open way around`, {
			icon: 'closed',
			text: `${name} closed`,
			tone: 'stop'
		});
	for (const a of d.avoided)
		add('ready', `${a.closed} is closed, so this drive goes over ${a.instead}`, {
			icon: 'closed',
			text: `${a.closed} closed`,
			tone: 'stop'
		});

	// Each pass: what it means for your vehicle (or, before you say, the state's own status).
	for (const p of d.passes) {
		const r = p.report;
		if (!r || r.status === 'off-season') continue;
		const a = d.vehicle ? passAnswer(r, d.vehicle, p.heading) : null;
		const l: Level = a
			? NEED_LEVEL[a.need]
			: r.status === 'closed'
				? 'stop'
				: r.status === 'chains' || r.status === 'traction'
					? 'ready'
					: 'go';
		const text = a ? a.text : r.label;
		add(l, l === 'go' ? null : `${p.name}: ${lower(text)}`, {
			icon: l === 'go' ? 'pass' : 'chains',
			text: `${p.name}: ${lower(l === 'go' && !a ? r.label : text)}`,
			tone: l
		});
	}
	// A closure in the notes of an open pass (a night closure, a gate past the summit): worth a look.
	for (const p of d.passes)
		if (p.report?.notice)
			add('ready', `${p.name}: ${lower(p.report.notice)}`, {
				icon: 'closed',
				text: `${p.name}: closure noted`,
				tone: 'ready'
			});
	const reported = d.passes.filter((p) => p.report && p.report.status !== 'off-season');
	// A pass with no report isn't a pass with no rules: show that it wasn't reported.
	const silent = d.passes.filter((p) => !p.report || p.report.status === 'off-season');
	for (const p of silent)
		facts.push({ icon: 'pass', text: `${p.name}: no report yet`, tone: 'unknown' });

	const w = d.warnings;
	if (w) {
		for (const c of w.closures)
			add('stop', `a road is closed on the way (${c.headline})`, {
				icon: 'closed',
				text: 'Road closed on the way',
				tone: 'stop'
			});
		for (const c of w.chainControls)
			add('ready', `chain control ${c.level} at ${c.name}`, {
				icon: 'chains',
				text: `Chains ${c.level} at ${c.name}`,
				tone: 'ready'
			});
		for (const a of w.alerts)
			add(
				a.tone === 'danger' ? 'ready' : 'go',
				a.tone === 'danger' ? `${lower(a.event)} on the way` : null,
				{
					icon: 'warning',
					text: a.event,
					tone: a.tone === 'danger' ? 'ready' : 'go'
				}
			);
		const icy = w.surface.filter((s) => s.surfaceF <= FREEZING_F);
		if (icy.length) {
			const coldest = icy.reduce((a, b) => (b.surfaceF < a.surfaceF ? b : a));
			add('ready', `the road surface is at freezing near ${shortName(coldest.name)}`, {
				icon: 'ice',
				text: `Road ${coldest.surfaceF}°F`,
				tone: 'ready'
			});
		}
	}

	// Weather when you get there: the worst stop, or the highest pass if all is calm (where snow and ice come
	// first; not simply the first pass on the way, which from Yakima is Manastash Ridge rather than Snoqualmie).
	if (d.weather?.length) {
		const bad = d.weather.filter((s) => s.hazard >= 2);
		const pick =
			bad.sort((a, b) => b.hazard - a.hazard)[0] ??
			highestPass(d.weather) ??
			d.weather.find((s) => s.kind === 'end');
		if (pick) {
			const when = d.clock?.(pick);
			const temp = pick.tempF !== null ? `${pick.tempF}°F` : '';
			if (pick.hazard >= 2) {
				const what = pick.hazards[0] ?? pick.phrase;
				add('ready', `${lower(what)} expected at ${pick.label}${when ? ` around ${when}` : ''}`, {
					icon: /ice/i.test(what) ? 'ice' : /snow/i.test(what) ? 'snow' : 'warning',
					text: `${what} at ${pick.label}`,
					tone: 'ready'
				});
			} else
				facts.push({
					icon: pick.precip === 'snow' ? 'snow' : 'temp',
					text: [temp, pick.phrase ? lower(pick.phrase) : '', `at ${pick.label}`, when ? when : '']
						.filter(Boolean)
						.join(' ')
						.replace(/^\w/, (c) => c.toUpperCase()),
					tone: 'go'
				});
		}
	}

	// Nothing reported anywhere yet (passes off season, warnings still loading): say so rather than "all clear".
	const nothingKnown = !reported.length && !w;
	if (level === 'go' && nothingKnown) level = 'unknown';
	if (w?.unchecked.length && level === 'go') level = 'unknown';

	const sentence =
		reasons.length > 0
			? `${capital(reasons.slice(0, 2).join('; '))}.`
			: level === 'unknown'
				? w?.unchecked.length
					? `Couldn't check ${w.unchecked.length > 1 ? 'some reports' : lower(w.unchecked[0])} just now. Look at the cameras below.`
					: 'No official pass reports yet. Look at the cameras below.'
				: `No closures, chain rules or warnings on the way.${
						silent.length
							? ` ${silent.map((p) => p.name).join(' and ')} ${silent.length > 1 ? 'have' : 'has'} no official report yet.`
							: ''
					}`;
	return { level, title: TITLES[level], sentence, facts: dedupe(facts).slice(0, 4) };
}

export interface PassInput {
	name: string;
	report: PassReport | null;
	snowDepthIn?: number | null;
}

/** A pass right now, in one glance. */
export function passVerdict(p: PassInput): Verdict {
	const r = p.report;
	if (!r || r.status === 'off-season')
		return {
			level: 'unknown',
			title: TITLES.unknown,
			sentence: `No official report for ${p.name} right now. The cameras below show the road.`,
			facts: []
		};
	const level: Level =
		r.status === 'closed'
			? 'stop'
			: r.status === 'chains' || r.status === 'traction' || r.notice
				? 'ready'
				: 'go';
	const bits = [r.label, r.tempF !== null ? `${Math.round(r.tempF)}°F` : null, r.weather || null]
		.filter(Boolean)
		.map((s) => lower(s as string));
	const facts: Fact[] = [
		{
			icon: level === 'go' ? 'pass' : level === 'stop' ? 'closed' : 'chains',
			text: r.label,
			tone: level
		}
	];
	if (r.tempF !== null) facts.push({ icon: 'temp', text: `${Math.round(r.tempF)}°F`, tone: 'go' });
	if (r.weather)
		facts.push({ icon: /snow/i.test(r.weather) ? 'snow' : 'temp', text: r.weather, tone: 'go' });
	if (p.snowDepthIn && p.snowDepthIn >= 2)
		facts.push({ icon: 'snow', text: `${p.snowDepthIn} in on the ground`, tone: 'go' });
	return {
		level,
		title: level === 'stop' ? 'Closed' : TITLES[level],
		sentence: `${p.name} right now: ${bits.join(', ')}.${r.notice ? ` ${r.notice}` : ''}`,
		facts: facts.slice(0, 4)
	};
}

/** The highest pass among the forecast stops (the first one when no heights are known). */
const highestPass = (stops: StopWeather[]) =>
	stops
		.filter((s) => s.kind === 'pass')
		.reduce<StopWeather | undefined>(
			(high, s) => (!high || (s.elevation_ft ?? 0) > (high.elevation_ft ?? 0) ? s : high),
			undefined
		);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Denny Creek on I-90 at mp 50.44" -> "Denny Creek". */
const shortName = (s: string) => s.replace(/\s+on\s+(I-|SR |US ).*$/i, '');
const dedupe = (facts: Fact[]) =>
	facts.filter((f, i) => facts.findIndex((g) => g.text === f.text) === i);
