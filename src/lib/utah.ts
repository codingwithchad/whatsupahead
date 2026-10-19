import {
	eventInEffect,
	eventPoints,
	kmToLines,
	reportLines,
	sameIdahoRoad,
	tidy,
	worse,
	type IdahoEvent
} from './idaho';
import type { SurfaceReading } from './roadSurface';
import {
	STATUS_LABEL,
	kmToStretch,
	type PassReport,
	type PassStatus,
	type Restriction
} from './passes';

// UDOT Traffic (Utah's 511) runs on the same system as Idaho 511 and Nevada 511. Its road-condition reports give
// each stretch of highway a road condition ("Dry", "Wet", "Snowy"...), the weather, and a restriction ("none",
// or UDOT's chain or traction rule in its own words). Crews update them in storms; some quiet stretches haven't
// been touched in a year, so an old report is no report.

interface Pt {
	lat: number;
	lon: number;
}

/** One road-condition report for a stretch of highway (UDOT Traffic `roadconditions`, the fields we use). */
export interface UtahRoadReport {
	Id: number;
	/** The highway and the stretch: "I-80 Parleys Summit", "SR-210 Upper Little Cottonwood Canyon". */
	RoadwayName?: string | null;
	RoadCondition?: string | null;
	WeatherCondition?: string | null;
	Restriction?: string | null;
	EncodedPolyline?: string[] | string | null;
	/** Unix seconds. */
	LastUpdated?: number | null;
}

/** One road weather station (UDOT Traffic `weatherstations`). */
export interface UtahStation {
	Id: number;
	Latitude: number;
	Longitude: number;
	StationName?: string | null;
	AirTemperature?: string | null;
	SurfaceTemp?: string | null;
	SurfaceStatus?: string | null;
	/** Unix seconds. */
	LastUpdated?: number | null;
}

// A report this old is history, not the road today.
const STALE_MS = 3 * 24 * 60 * 60 * 1000;

/** What a UDOT report means for the pass. */
export function utahStatus(r: Pick<UtahRoadReport, 'RoadCondition' | 'Restriction'>): PassStatus {
	const restriction = (r.Restriction ?? '').trim();
	if (/\bclosed\b/i.test(restriction) || /\bclosed\b/i.test(r.RoadCondition ?? '')) return 'closed';
	if (!restriction || /^none$/i.test(restriction)) return 'open';
	if (/recommend|advis/i.test(restriction)) return 'traction';
	if (/chain|traction|4wd|awd|4x4|(four|all)[- ]wheel|snow tire/i.test(restriction))
		return 'chains';
	return 'open';
}

/** "I-80 Parleys Summit" -> "Parleys Summit": the stretch, without the highway the pass already names. */
const stretch = (name: string | null | undefined) =>
	tidy(name).replace(/^\s*(?:I|US|SR|UT)[- ]?\d+\s*/i, '');

/** A UDOT road weather station's pavement temperature, or null when it has none or is over two hours old. */
export function utahSurface(
	s: UtahStation,
	now = Date.now(),
	maxAgeMs = 2 * 3600_000
): SurfaceReading | null {
	const surfaceF = Number(s.SurfaceTemp);
	const airF = Number(s.AirTemperature);
	const at = (s.LastUpdated ?? 0) * 1000;
	if (s.SurfaceTemp == null || !Number.isFinite(surfaceF) || surfaceF < -40 || surfaceF > 160)
		return null;
	if (!s.Latitude || !s.Longitude || !(now - at <= maxAgeMs)) return null;
	return {
		name: tidy(s.StationName) || 'Road weather station',
		lat: s.Latitude,
		lon: s.Longitude,
		surfaceF: Math.round(surfaceF),
		airF: s.AirTemperature == null || !Number.isFinite(airF) ? null : Math.round(airF),
		wet: /wet|snow|ice|slush/i.test(s.SurfaceStatus ?? ''),
		at
	};
}

/** A pass's report from UDOT's road reports, events and the nearest road weather station. */
export function utahPassReport(
	pass: Pt & { id: string; report: { route: string; radius_km?: number } },
	roads: UtahRoadReport[],
	events: IdahoEvent[],
	stations: UtahStation[],
	{ now = Date.now() }: { now?: number } = {}
): PassReport {
	const km = pass.report.radius_km ?? 8;
	const onRoad = (road: string | null | undefined) => sameIdahoRoad(road, pass.report.route);
	const reports = roads.filter(
		(r) =>
			r.LastUpdated &&
			now - r.LastUpdated * 1000 < STALE_MS &&
			onRoad(r.RoadwayName) &&
			kmToLines(pass, reportLines(r.EncodedPolyline)) <= km
	);
	const closures = events.filter(
		(e) =>
			e.IsFullClosure &&
			onRoad(e.RoadwayName) &&
			eventPoints(e).some((p) => kmToStretch(pass, p) <= km) &&
			eventInEffect(e, now)
	);

	let status: PassStatus = reports.length
		? reports.map(utahStatus).reduce((a, b) => worse(a, b))
		: 'off-season';
	if (closures.length) status = 'closed';
	const restrictions: Restriction[] = reports
		.filter((r) => ['chains', 'traction'].includes(utahStatus(r)))
		.map((r) => ({ direction: stretch(r.RoadwayName), text: tidy(r.Restriction) }));

	const latest = [...reports].sort((a, b) => (b.LastUpdated ?? 0) - (a.LastUpdated ?? 0))[0];
	const station = stations
		.map((s) => ({ s, d: kmToStretch(pass, { lat: s.Latitude, lon: s.Longitude }) }))
		.filter((x) => x.d <= 3 && x.s.LastUpdated && now - x.s.LastUpdated * 1000 < 2 * 3600_000)
		.sort((a, b) => a.d - b.d)[0]?.s;
	const temp = Number(station?.AirTemperature);
	const updated = Math.max(
		...[latest?.LastUpdated, ...closures.map((c) => c.LastUpdated)].map((t) => (t ? t * 1000 : 0))
	);
	return {
		id: pass.id,
		status,
		label: status === 'off-season' ? 'No report' : STATUS_LABEL[status],
		restrictions,
		road: closures.length
			? tidy(closures[0].Description)
			: reports
					.map((r) => `${tidy(r.RoadCondition)} (${stretch(r.RoadwayName)})`)
					.filter((s) => !s.startsWith(' ('))
					.join('. '),
		weather: tidy(latest?.WeatherCondition),
		tempF:
			station && station.AirTemperature !== null && Number.isFinite(temp) ? Math.round(temp) : null,
		advisory: false,
		updated: updated || null
	};
}
