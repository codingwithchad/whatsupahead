import type { PassReport, PassStatus } from './passes';
import type { RoadWarnings } from './roadAhead';
import { FREEZING_F, NEAR_FREEZING_F } from './roadSurface';
import type { RouteWeather } from './routeWeather';

// What changed on the road ahead between two updates of a drive page, said in one line each, worst first: so
// a driver who left in sunshine hears "Road surface at freezing at Denny Creek" before they get there.

export interface Snapshot {
	passes: { id: string; name: string; along: number; report: PassReport | null }[];
	warnings: RoadWarnings | null;
	onTheWay: RouteWeather | null;
}

export interface Change {
	tone: 'danger' | 'caution' | 'good';
	text: string;
}

const SEVERITY: PassStatus[] = ['closed', 'chains', 'traction', 'open', 'off-season'];
const worse = (a: PassStatus, b: PassStatus) => SEVERITY.indexOf(a) < SEVERITY.indexOf(b);
const TONE_ORDER = ['danger', 'caution', 'good'];

/**
 * The changes on the part of the drive still ahead (`progress` miles along; null when not following, so the
 * whole drive counts). `clock` formats a time for the weather lines.
 */
export function tripChanges(
	prev: Snapshot,
	next: Snapshot,
	progress: number | null,
	clock: (ms: number, at: { lat: number; lon: number }) => string = () => ''
): Change[] {
	const ahead = (along: number) => progress === null || along >= progress - 0.5;
	const out: Change[] = [];

	for (const p of next.passes) {
		if (!ahead(p.along) || !p.report) continue;
		const was = prev.passes.find((x) => x.id === p.id)?.report;
		if (!was) continue;
		const now = p.report;
		if (now.status === 'off-season' || was.status === 'off-season') continue;
		if (worse(now.status, was.status))
			out.push({
				tone: now.status === 'closed' || now.status === 'chains' ? 'danger' : 'caution',
				text: `${p.name}: now ${now.label.toLowerCase()} (was ${was.label.toLowerCase()}).`
			});
		else if (worse(was.status, now.status))
			out.push({
				tone: 'good',
				text: `${p.name}: ${was.status === 'closed' ? 'open again' : 'better'}, ${now.label.toLowerCase()}.`
			});
		else if (now.label !== was.label)
			out.push({ tone: 'caution', text: `${p.name}: now ${now.label.toLowerCase()}.` });
	}

	const w = next.warnings;
	const pw = prev.warnings;
	if (w && pw) {
		for (const c of w.closures)
			if (ahead(c.along) && !pw.closures.some((x) => x.headline === c.headline))
				out.push({ tone: 'danger', text: `Closed on your way: ${c.headline}` });
		for (const c of w.chainControls) {
			if (!ahead(c.along)) continue;
			const was = pw.chainControls.find((x) => x.name === c.name && x.direction === c.direction);
			if (!was || was.level !== c.level)
				out.push({ tone: 'danger', text: `Chain control ${c.level} now at ${c.name}.` });
		}
		for (const a of w.alerts)
			if (ahead(a.toMile) && !pw.alerts.some((x) => x.event === a.event))
				out.push({
					tone: a.tone,
					text: `${a.event} now in effect${a.near ? ` near ${a.near}` : ''} on your way.`
				});
		for (const s of w.surface) {
			if (!ahead(s.along)) continue;
			const was = pw.surface.find((x) => x.name === s.name)?.surfaceF;
			if (s.surfaceF <= FREEZING_F && (was === undefined || was > FREEZING_F))
				out.push({
					tone: 'danger',
					text: `Road surface at freezing at ${s.name}: ${s.surfaceF}°F. Ice can form.`
				});
			else if (
				s.surfaceF <= NEAR_FREEZING_F &&
				s.surfaceF > FREEZING_F &&
				was !== undefined &&
				was > NEAR_FREEZING_F
			)
				out.push({
					tone: 'caution',
					text: `Road surface near freezing at ${s.name}: ${s.surfaceF}°F.`
				});
		}
	}

	// Weather when you get there. Two different forecast services can disagree, so only compare like with like.
	const nw = next.onTheWay;
	const pwx = prev.onTheWay;
	if (nw && pwx && nw.source === pwx.source)
		for (const s of nw.stops) {
			if (s.kind === 'start' || s.kind === 'way' || !ahead(s.along)) continue;
			const was = pwx.stops.find((x) => x.label === s.label);
			if (!was) continue;
			const fresh = s.hazards.find((h) => !was.hazards.includes(h));
			if (s.hazard >= 2 && (was.hazard < 2 || fresh))
				out.push({
					tone: 'caution',
					text: `${fresh ?? s.hazards[0] ?? s.phrase} now expected at ${s.label} when you get there${
						clock(Date.now() + s.minutesIn * 60_000, s)
							? `, ${clock(Date.now() + s.minutesIn * 60_000, s)}`
							: ''
					}.`
				});
		}

	return out.sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone));
}
