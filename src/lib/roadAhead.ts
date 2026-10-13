import type { Point } from './geo';
import { parseDotNetDate } from './transit';
import {
	closureInEffect,
	type CaltransClosure,
	type Checkpoint,
	type OdotIncident
} from './passes';
import { headingAt, projectNear, type LatLon } from './route';

// What could stop a drive besides a closed pass: full road closures the states report, and National Weather
// Service warnings (winter storms, floods, wind) for the places on the way at the time you get there.

export interface RoadClosure {
	source: 'WSDOT' | 'ODOT' | 'Caltrans';
	headline: string;
	start: Point;
	end: Point;
	updated: number | null;
	link: string;
}

export interface ClosureOnRoute extends RoadClosure {
	along: number;
}

/** One WSDOT highway alert (the fields we use). */
export interface WsdotAlert {
	AlertID: number;
	EventCategory?: string;
	HeadlineDescription?: string;
	StartTime?: string | null;
	EndTime?: string | null;
	LastUpdatedTime?: string | null;
	StartRoadwayLocation?: { Latitude?: number; Longitude?: number; RoadName?: string };
	EndRoadwayLocation?: { Latitude?: number; Longitude?: number };
}

// The whole road, not a lane or a ramp. WSDOT files many lane and shoulder closures under "Closure", and some
// "Closure" alerts are only delays, so the wording decides.
const WHOLE_ROAD =
	/\b(?:road|highway|roadway|pass|bridge|(?:I|SR|US)[- ]?\d+)\b[^.]{0,80}?\b(?:is|are|remains?|will be|has been)\s+(?:now\s+|still\s+|temporarily\s+|fully\s+|completely\s+)?closed\b|\bfull(?:y)?\s+clos|\bclosed (?:in|to) both directions\b|\ball lanes (?:are |will be )?(?:closed|blocked)\b/i;
const PART =
	/\b(?:up to (?:one|two|three|four|\d)|one|two|three|four|right|left|center|inside|outside|single|hov|express)\s+lanes?\b|\bshoulder\b|\bramps?\b|\bsidewalk\b|\btrail\b|\bexit\b/i;
const ALL = /\ball lanes\b|\bboth directions\b|\bfull(?:y)?\s+clos/i;

/** Does this headline describe the whole road closed (not lanes, ramps or delays)? */
export function wholeRoadClosed(headline: string): boolean {
	return WHOLE_ROAD.test(headline) && (!PART.test(headline) || ALL.test(headline));
}

const pt = (lat: unknown, lon: unknown): Point | null =>
	typeof lat === 'number' && typeof lon === 'number' && lat && lon ? { lat, lon } : null;
const dotNet = (s?: string | null) => (s ? parseDotNetDate(s) : null);

export function wsdotClosure(a: WsdotAlert, now = Date.now()): RoadClosure | null {
	const headline = (a.HeadlineDescription ?? '').replace(/\s+/g, ' ').trim();
	if (!wholeRoadClosed(headline)) return null;
	const begins = dotNet(a.StartTime);
	const ends = dotNet(a.EndTime);
	if ((begins !== null && begins > now + 12 * 3600_000) || (ends !== null && ends < now))
		return null;
	const start = pt(a.StartRoadwayLocation?.Latitude, a.StartRoadwayLocation?.Longitude);
	if (!start) return null;
	return {
		source: 'WSDOT',
		headline,
		start,
		end: pt(a.EndRoadwayLocation?.Latitude, a.EndRoadwayLocation?.Longitude) ?? start,
		updated: dotNet(a.LastUpdatedTime),
		link: 'https://wsdot.com/travel/real-time/map/'
	};
}

/** ODOT incidents with impact 4 are closures; ramps, lanes and shoulders are not the road. */
export function odotClosure(i: OdotIncident): RoadClosure | null {
	if (i['is-active'] === 'false' || i['impact-id'] !== '4') return null;
	const headline = (i.headline ?? '').replace(/\s+/g, ' ').trim();
	if (!headline || /\bramps?\b|\blanes?\b|shoulder/i.test(headline)) return null;
	const s = i.location?.['start-location'];
	const e = i.location?.['end-location'];
	const start = pt(s?.['start-lat'], s?.['start-long']);
	if (!start) return null;
	return {
		source: 'ODOT',
		headline,
		start,
		end: pt(e?.['end-lat'], e?.['end-long']) ?? start,
		updated: i['update-time'] ? Date.parse(i['update-time']) || null : null,
		link: 'https://tripcheck.com/'
	};
}

export function caltransClosure(c: CaltransClosure, now = Date.now()): RoadClosure | null {
	if (!closureInEffect(c, now)) return null;
	const b = c.location.begin;
	const e = c.location.end;
	const start = pt(Number(b.beginLatitude), Number(b.beginLongitude));
	if (!start) return null;
	const from = b.beginLocationName || b.beginFreeFormDescription;
	const to = e.endLocationName || e.endFreeFormDescription;
	const where = from && to && from !== to ? ` from ${from} to ${to}` : from ? ` at ${from}` : '';
	return {
		source: 'Caltrans',
		headline: [
			`${b.beginRoute ? `${b.beginRoute} closed` : 'Closed'}${where}`,
			c.closure.typeOfWork
		]
			.filter(Boolean)
			.join('. '),
		start,
		end: pt(Number(e.endLatitude), Number(e.endLongitude)) ?? start,
		updated: Number(c.closure.closureTimestamp?.closureStartEpoch) * 1000 || null,
		link: 'https://quickmap.dot.ca.gov/'
	};
}

/** Closures with an end on the road you will drive (within about a fifth of a mile), in driving order. */
export function closuresOnRoute(
	closures: RoadClosure[],
	route: LatLon[],
	cum: number[],
	miles = 0.2
): ClosureOnRoute[] {
	const out: ClosureOnRoute[] = [];
	for (const c of closures) {
		const hits = [c.start, c.end]
			.map((p) => projectNear(p, route, cum, miles))
			.filter((p) => p !== null);
		if (hits.length) out.push({ ...c, along: Math.min(...hits.map((h) => h.along)) });
	}
	return out.sort((a, b) => a.along - b.along);
}

const COMPASS: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };

/**
 * Caltrans chain controls in effect on the road you will drive, for your direction: each checkpoint is for one
 * way (the other side of the road has its own), within about a sixth of a mile of the route.
 */
export function chainControlsOnRoute(
	checkpoints: Checkpoint[],
	route: LatLon[],
	cum: number[],
	miles = 0.15
): (Checkpoint & { along: number })[] {
	const out: (Checkpoint & { along: number })[] = [];
	for (const c of checkpoints) {
		if (c.level === 'R-0') continue;
		const p = projectNear(c, route, cum, miles);
		if (!p) continue;
		const way = COMPASS[c.direction.toLowerCase()];
		const heading = headingAt(route, cum, p.along);
		if (way !== undefined && heading !== null && Math.abs(((heading - way + 540) % 360) - 180) > 60)
			continue;
		out.push({ ...c, along: p.along });
	}
	return out.sort((a, b) => a.along - b.along);
}

/** What the drive page shows besides the passes. */
export interface RoadWarnings {
	/** WSDOT road surface temperatures beside the road (Washington only). */
	surface: import('./roadSurface').SurfaceOnRoute[];
	closures: ClosureOnRoute[];
	/** Caltrans chain controls in effect on the way. */
	chainControls: (Checkpoint & { along: number })[];
	alerts: (RouteAlert & { near: string | null })[];
	/** Sources we could not reach for this drive, so the page never reads silence as an all-clear. */
	unchecked: string[];
}

// ---- Weather warnings ----------------------------------------------------------------------------------

/** The warnings that matter on the road, and how loudly to show each. Frost, surf and heat are left out. */
export const ROAD_EVENTS: Record<string, 'danger' | 'caution'> = {
	'Blizzard Warning': 'danger',
	'Winter Storm Warning': 'danger',
	'Ice Storm Warning': 'danger',
	'Snow Squall Warning': 'danger',
	'Lake Effect Snow Warning': 'danger',
	'Avalanche Warning': 'danger',
	'Flash Flood Warning': 'danger',
	'Flood Warning': 'danger',
	'High Wind Warning': 'danger',
	'Extreme Wind Warning': 'danger',
	'Dust Storm Warning': 'danger',
	'Extreme Cold Warning': 'danger',
	'Fire Warning': 'danger',
	'Evacuation Immediate': 'danger',
	'Tornado Warning': 'danger',
	'Winter Storm Watch': 'caution',
	'Winter Weather Advisory': 'caution',
	'Avalanche Watch': 'caution',
	'Avalanche Advisory': 'caution',
	'Flood Watch': 'caution',
	'Flash Flood Watch': 'caution',
	'Flood Advisory': 'caution',
	'High Wind Watch': 'caution',
	'Wind Advisory': 'caution',
	'Dense Fog Advisory': 'caution',
	'Freezing Fog Advisory': 'caution',
	'Blowing Dust Advisory': 'caution',
	'Dense Smoke Advisory': 'caution'
};

/** One active NWS alert (the fields we use). */
export interface NwsAlert {
	id: string;
	geometry: { type: string; coordinates: unknown } | null;
	properties: {
		event: string;
		headline?: string | null;
		status?: string;
		messageType?: string;
		onset?: string | null;
		effective?: string | null;
		ends?: string | null;
		expires?: string | null;
		areaDesc?: string;
		geocode?: { UGC?: string[] };
	};
}

/** A point on the drive: where, how far along, when you get there, and the NWS zones it is in. */
export interface Sample extends Point {
	along: number;
	at: number;
	zones: string[];
}

export interface RouteAlert {
	event: string;
	tone: 'danger' | 'caution';
	fromMile: number;
	toMile: number;
	/** Where it starts on the drive, for the link to the forecast there. */
	at: Point;
	/** When you reach it. */
	reach: number;
	ends: number | null;
}

function inRing(p: Point, ring: number[][]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi)
			inside = !inside;
	}
	return inside;
}

/** Is the point inside a GeoJSON Polygon or MultiPolygon (holes respected)? */
export function inGeometry(p: Point, g: { type: string; coordinates: unknown }): boolean {
	const inPolygon = (rings: number[][][]) =>
		inRing(p, rings[0]) && !rings.slice(1).some((h) => inRing(p, h));
	if (g.type === 'Polygon') return inPolygon(g.coordinates as number[][][]);
	if (g.type === 'MultiPolygon') return (g.coordinates as number[][][][]).some(inPolygon);
	return false;
}

const when = (s?: string | null) => (s ? Date.parse(s) || null : null);

/**
 * The warnings you will drive into: the alert covers the point (by zone, and by its drawn area when it has one)
 * and is in effect when you get there. One entry per alert, from the first to the last mile it covers.
 */
export function alertsOnRoute(alerts: NwsAlert[], samples: Sample[]): RouteAlert[] {
	const out: RouteAlert[] = [];
	for (const a of alerts) {
		const p = a.properties;
		const tone = ROAD_EVENTS[p.event];
		if (!tone || p.status !== 'Actual' || p.messageType === 'Cancel') continue;
		const ugc = new Set(p.geocode?.UGC ?? []);
		const starts = when(p.onset) ?? when(p.effective) ?? 0;
		const ends = when(p.ends) ?? when(p.expires);
		const hits = samples.filter(
			(s) =>
				s.zones.some((z) => ugc.has(z)) &&
				(!a.geometry || inGeometry(s, a.geometry)) &&
				s.at >= starts &&
				(ends === null || s.at <= ends)
		);
		if (!hits.length) continue;
		out.push({
			event: p.event,
			tone,
			fromMile: hits[0].along,
			toMile: hits[hits.length - 1].along,
			at: { lat: hits[0].lat, lon: hits[0].lon },
			reach: hits[0].at,
			ends
		});
	}
	// One line per kind of warning: the same event from two offices reads as one stretch.
	const merged = new Map<string, RouteAlert>();
	for (const a of out) {
		const m = merged.get(a.event);
		if (!m) merged.set(a.event, a);
		else {
			if (a.fromMile < m.fromMile)
				Object.assign(m, { fromMile: a.fromMile, at: a.at, reach: a.reach });
			m.toMile = Math.max(m.toMile, a.toMile);
			m.ends = m.ends === null || a.ends === null ? null : Math.max(m.ends, a.ends);
		}
	}
	return [...merged.values()].sort(
		(a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1) || a.fromMile - b.fromMile
	);
}

/** Points about every `step` miles from start to end (at most `max`), each with the time you reach it. */
export function samplePoints(
	route: LatLon[],
	cum: number[],
	minutes: number,
	departAt: number,
	step = 8,
	max = 60
): Omit<Sample, 'zones'>[] {
	const total = cum[cum.length - 1] ?? 0;
	const every = Math.max(step, total / (max - 1));
	const out: Omit<Sample, 'zones'>[] = [];
	let next = 0;
	for (let i = 0; i < route.length; i++) {
		if (cum[i] + 1e-9 < next && i !== route.length - 1) continue;
		out.push({
			lat: route[i][0],
			lon: route[i][1],
			along: cum[i],
			at: departAt + (minutes * 60_000 * cum[i]) / Math.max(total, 0.1)
		});
		next = cum[i] + every;
	}
	return out;
}
