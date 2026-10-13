import {
	eventInEffect,
	eventPoints,
	kmToLines,
	list,
	reportLines,
	sameIdahoRoad,
	tidy,
	worse,
	type IdahoEvent
} from './idaho';
import {
	STATUS_LABEL,
	kmToStretch,
	type PassReport,
	type PassStatus,
	type Restriction
} from './passes';

// Nevada 511 (NDOT) runs on the same system as Idaho 511. Its road-condition reports carry NDOT's chain
// controls in their own words, which its definitions page lists in full (nvroads.com/about/definitions):
// "Chains or Snow Tires Required", "Chains Required, All Vehicles except 4-wheel drive with Snow tires",
// "Holding Traffic", "Road Closed", "Adverse Driving Conditions", the two wind warnings, and "No Report".

interface Pt {
	lat: number;
	lon: number;
}

/** One road-condition report for a stretch of highway (Nevada 511 `roadconditions`, the fields we use). */
export interface NevadaRoadReport {
	Id: number;
	LocationDescription?: string | null;
	'Overall Status'?: string | null;
	'Secondary Conditions'?: string[] | string | null;
	RoadwayName?: string | null;
	EncodedPolyline?: string[] | string | null;
	/** Unix seconds. */
	LastUpdated?: number | null;
}

/** One road weather station (Nevada 511 `weatherstations`; no pavement temperature). */
export interface NevadaStation {
	Id: number;
	Latitude: number;
	Longitude: number;
	DeviceName?: string | null;
	AirTemperature?: string | null;
	/** Unix seconds. */
	LastUpdated?: number | null;
}

/** What one of NDOT's condition words means for the pass. */
export function nevadaStatus(overall: string): PassStatus | null {
	const t = overall.trim();
	if (!t || /^no report$/i.test(t)) return null;
	if (/road closed|holding traffic/i.test(t)) return 'closed';
	if (/chains|snow tires/i.test(t)) return 'chains';
	return 'open';
}

/** A pass's report from Nevada 511's road reports, events and the nearest weather station. */
export function nevadaPassReport(
	pass: Pt & { id: string; report: { route: string; radius_km?: number } },
	roads: NevadaRoadReport[],
	events: IdahoEvent[],
	stations: NevadaStation[],
	{ now = Date.now() }: { now?: number } = {}
): PassReport {
	const km = pass.report.radius_km ?? 8;
	const onRoad = (road: string | null | undefined) => sameIdahoRoad(road, pass.report.route);
	const reports = roads.filter(
		(r) =>
			nevadaStatus(r['Overall Status'] ?? '') !== null &&
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

	let status: PassStatus = 'off-season';
	const restrictions: Restriction[] = [];
	const notices: string[] = [];
	for (const r of reports) {
		const overall = (r['Overall Status'] ?? '').trim();
		const s = nevadaStatus(overall)!;
		status = status === 'off-season' ? s : worse(status, s);
		const where = tidy(r.LocationDescription);
		if (s === 'chains') restrictions.push({ direction: where, text: overall });
		else if (s === 'open' || /holding traffic/i.test(overall))
			notices.push(`${overall}${where ? ` (${where})` : ''}`);
		notices.push(...list(r['Secondary Conditions']));
	}
	if (closures.length) status = 'closed';

	const latest = [...reports].sort((a, b) => (b.LastUpdated ?? 0) - (a.LastUpdated ?? 0))[0];
	const station = stations
		.map((s) => ({ s, d: kmToStretch(pass, { lat: s.Latitude, lon: s.Longitude }) }))
		.filter((x) => x.d <= 3 && x.s.LastUpdated && now - x.s.LastUpdated * 1000 < 2 * 3600_000)
		.sort((a, b) => a.d - b.d)[0]?.s;
	const temp = Number(station?.AirTemperature);
	const label =
		status === 'off-season'
			? 'No report'
			: reports.some((r) => /holding traffic/i.test(r['Overall Status'] ?? '')) &&
				  !closures.length &&
				  !reports.some((r) => /road closed/i.test(r['Overall Status'] ?? ''))
				? 'Traffic held'
				: STATUS_LABEL[status];
	const updated = Math.max(
		...[latest?.LastUpdated, ...closures.map((c) => c.LastUpdated)].map((t) => (t ? t * 1000 : 0))
	);
	return {
		id: pass.id,
		status,
		label,
		restrictions,
		road: closures.length
			? tidy(closures[0].Description)
			: reports
					.map((r) => `${(r['Overall Status'] ?? '').trim()} (${tidy(r.LocationDescription)})`)
					.join('. '),
		weather: '',
		tempF: station && station.AirTemperature !== null && Number.isFinite(temp) ? temp : null,
		advisory: false,
		updated: updated || null,
		...(notices.length && status !== 'closed' ? { notice: [...new Set(notices)].join('. ') } : {})
	};
}
