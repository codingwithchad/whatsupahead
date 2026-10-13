import {
	STATUS_LABEL,
	kmToStretch,
	type PassReport,
	type PassStatus,
	type Restriction
} from './passes';
import type { RoadClosure } from './roadAhead';
import type { SurfaceReading } from './roadSurface';

// Idaho 511 (the Idaho Transportation Department) has no pass report of its own: its pass list is only names and
// places. A pass's report is put together from ITD's road-condition reports for the stretch over it, its
// closures, and the weather station at the summit. Idaho has no traction-tire signs like Washington's or
// Oregon's; when crews report snow or ice, the answer is to carry chains and go prepared.

interface Pt {
	lat: number;
	lon: number;
}

/** One road-condition report for a stretch of highway (Idaho 511 `winterroads`, the fields we use). */
export interface IdahoRoadReport {
	Id: number;
	LocationDescription?: string | null;
	'Overall Status'?: string | null;
	'Weather Conditions'?: string[] | string | null;
	'Special Conditions'?: string[] | string | null;
	RoadwayName?: string | null;
	/** One or more Google encoded polylines; Idaho 511 sends a JSON list, sometimes as a string. */
	EncodedPolyline?: string[] | string | null;
	/** Unix seconds. */
	LastUpdated?: number | null;
}

/** One traffic event (Idaho 511 `event`, the fields we use). */
export interface IdahoEvent {
	ID: number;
	RoadwayName?: string | null;
	DirectionOfTravel?: string | null;
	Description?: string | null;
	EventType?: string | null;
	IsFullClosure?: boolean | null;
	Latitude?: number | null;
	Longitude?: number | null;
	LatitudeSecondary?: number | null;
	LongitudeSecondary?: number | null;
	/** Unix seconds. */
	StartDate?: number | null;
	PlannedEndDate?: number | null;
	LastUpdated?: number | null;
	RecurrenceSchedules?: {
		StartDate?: string | null;
		EndDate?: string | null;
		Times?: { StartTime?: string | null; EndTime?: string | null }[] | null;
		DaysOfWeek?: string[] | null;
	}[];
}

/** One road weather station (Idaho 511 `weatherstations`; every value is a string). */
export interface IdahoStation {
	Id: string;
	Name?: string;
	Latitude: string;
	Longitude: string;
	/** Unix seconds. */
	LastUpdated?: string;
	AirTemperature?: string;
	SurfaceTemperature?: string;
	SurfaceStatus?: string;
	Precipitation?: string;
	Precipitation6H?: string;
	/** The camera at the station; Idaho 511's pass list names a pass's station by this. */
	CameraSourceId?: string;
}

/** Decode one Google encoded polyline to points. */
export function decodePolyline(s: string): Pt[] {
	const out: Pt[] = [];
	let i = 0;
	let lat = 0;
	let lon = 0;
	const next = () => {
		let result = 0;
		let shift = 0;
		let b: number;
		do {
			b = s.charCodeAt(i++) - 63;
			result |= (b & 0x1f) << shift;
			shift += 5;
		} while (b >= 0x20 && i < s.length);
		return result & 1 ? ~(result >> 1) : result >> 1;
	};
	while (i < s.length) {
		lat += next();
		lon += next();
		out.push({ lat: lat / 1e5, lon: lon / 1e5 });
	}
	return out;
}

/** The stretches of road a report covers, as lines of points. */
export function reportLines(field: IdahoRoadReport['EncodedPolyline']): Pt[][] {
	let list: unknown = field;
	if (typeof field === 'string') {
		try {
			list = field.trim().startsWith('[') ? JSON.parse(field) : [field];
		} catch {
			list = [field];
		}
	}
	return Array.isArray(list)
		? list.filter((s): s is string => typeof s === 'string' && s.length > 0).map(decodePolyline)
		: [];
}

/**
 * "I-90", "I 90" and "US-95", "US 95" are the same road; so are a state's own names for its highways ("SH-21",
 * "ID-21"; Nevada's "SR-431", "NV-431"). Used for Idaho 511 and Nevada 511, which are the same system.
 */
export const sameIdahoRoad = (a: string | null | undefined, b: string) => {
	const norm = (s: string) =>
		s
			.toUpperCase()
			.replace(/^(SH|ID|SR|NV)\b/, 'SH')
			.replace(/[^A-Z0-9]/g, '');
	const road = (a ?? '').match(/^\s*((?:I|US|SH|ID|SR|NV)[- ]?\d+)/i)?.[1];
	return road !== undefined && norm(road) === norm(b);
};

export const list = (v: string[] | string | null | undefined): string[] =>
	(Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);

/** How far a report's stretch comes to a point, in km. */
export function kmToLines(p: Pt, lines: Pt[][]): number {
	let best = Infinity;
	for (const line of lines)
		for (let i = 0; i < line.length; i++)
			best = Math.min(best, kmToStretch(p, line[i], line[i + 1] ?? line[i]));
	return best;
}

// Crews' words for a road with snow or ice on it. Idaho 511 publishes no list of them; these match the words
// such reports use ("Snow Covered", "Icy Spots", "Slushy", "Packed Snow", "Scattered Snow and Ice").
const WINTER = /snow|\bic(e|y)\b|slush|packed|frost|black ice|drift/i;
const CLOSED = /\bclosed\b/i;
const NOT_ADVISED = /travel not advised|impassable|no travel/i;
const CHAINS = /\bchains? (are |is )?required\b|\btraction (tires? )?(law|required)\b/i;

/** Whether a closure or restriction is in effect now: started, not ended, and on today's hours if it has hours. */
export function eventInEffect(e: IdahoEvent, now = Date.now()): boolean {
	if (e.StartDate && e.StartDate * 1000 > now) return false;
	if (e.PlannedEndDate && e.PlannedEndDate * 1000 < now) return false;
	const schedules = e.RecurrenceSchedules ?? [];
	if (!schedules.length) return true;
	return schedules.some((s) => {
		// Times carry their own offset: "06:00:00-06:00:00" is 6 AM Mountain daylight time.
		const offset = (s.Times?.[0]?.StartTime ?? '').match(/([+-])(\d\d):(\d\d):\d\d$/);
		const shiftMs = offset
			? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000
			: -6 * 3600_000;
		const local = new Date(now + shiftMs);
		const day = local.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
		if (s.DaysOfWeek?.length && !s.DaysOfWeek.includes(day)) return false;
		const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
		const clock = (t?: string | null) => {
			const m = (t ?? '').match(/^(\d\d):(\d\d)/);
			return m ? Number(m[1]) * 60 + Number(m[2]) : null;
		};
		const times = s.Times ?? [];
		if (!times.length) return true;
		return times.some((t) => {
			const from = clock(t.StartTime);
			const to = clock(t.EndTime);
			if (from === null || to === null) return true;
			// Overnight hours ("20:00 to 06:00") wrap past midnight.
			return from <= to ? minutes >= from && minutes <= to : minutes >= from || minutes <= to;
		});
	});
}

export const eventPoints = (e: IdahoEvent): Pt[] =>
	[
		[e.Latitude, e.Longitude],
		[e.LatitudeSecondary, e.LongitudeSecondary]
	]
		.filter(([lat, lon]) => typeof lat === 'number' && typeof lon === 'number' && lat && lon)
		.map(([lat, lon]) => ({ lat: lat as number, lon: lon as number }));

export const tidy = (s: string | null | undefined) =>
	(s ?? '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const num = (s: string | undefined) => {
	const n = Number(s);
	return s !== undefined && s !== '' && s !== 'None' && Number.isFinite(n) ? n : null;
};

/**
 * A pass's report from Idaho's road reports, events and its summit weather station. `station` is the station
 * Idaho 511's pass list names (by its camera id), when it names one.
 */
export function idahoPassReport(
	pass: Pt & { id: string; report: { route: string; radius_km?: number; station?: string } },
	roads: IdahoRoadReport[],
	events: IdahoEvent[],
	stations: IdahoStation[],
	{ now = Date.now() }: { now?: number } = {}
): PassReport {
	const km = pass.report.radius_km ?? 8;
	const onRoad = (road: string | null | undefined) => sameIdahoRoad(road, pass.report.route);
	const reports = roads
		.filter((r) => onRoad(r.RoadwayName) && kmToLines(pass, reportLines(r.EncodedPolyline)) <= km)
		.filter((r) => !/^no report$/i.test((r['Overall Status'] ?? '').trim()));
	const near = events.filter(
		(e) =>
			onRoad(e.RoadwayName) &&
			eventPoints(e).some((p) => kmToStretch(pass, p) <= km) &&
			eventInEffect(e, now)
	);
	const closures = near.filter((e) => e.IsFullClosure);
	const station =
		stations.find((s) => pass.report.station && s.CameraSourceId === pass.report.station) ??
		stations
			.map((s) => ({
				s,
				d: kmToStretch(pass, { lat: Number(s.Latitude), lon: Number(s.Longitude) })
			}))
			.filter((x) => x.d <= 3)
			.sort((a, b) => a.d - b.d)[0]?.s;
	const stationFresh =
		station &&
		num(station.LastUpdated) !== null &&
		now - num(station.LastUpdated)! * 1000 < 2 * 3600_000;

	let status: PassStatus = 'off-season';
	const restrictions: Restriction[] = [];
	const notices: string[] = [];
	for (const r of reports) {
		const overall = (r['Overall Status'] ?? '').trim();
		const all = [overall, ...list(r['Weather Conditions']), ...list(r['Special Conditions'])].join(
			' '
		);
		let s: PassStatus = 'open';
		if (CLOSED.test(overall)) s = 'closed';
		else if (WINTER.test(all) || NOT_ADVISED.test(all)) s = 'traction';
		if (NOT_ADVISED.test(all)) notices.push(`${overall}: ${tidy(r.LocationDescription)}`);
		status = status === 'off-season' ? s : worse(status, s);
	}
	for (const e of near) {
		const text = tidy(e.Description);
		if (CHAINS.test(text)) {
			status = worse(status === 'off-season' ? 'open' : status, 'chains');
			restrictions.push({ direction: e.DirectionOfTravel ?? '', text });
		}
	}
	if (closures.length) status = 'closed';

	const latest = [...reports].sort((a, b) => (b.LastUpdated ?? 0) - (a.LastUpdated ?? 0))[0];
	const road = closures.length
		? tidy(closures[0].Description)
		: reports
				.map((r) =>
					[
						(r['Overall Status'] ?? '').trim(),
						...list(r['Special Conditions']),
						tidy(r.LocationDescription) && `(${tidy(r.LocationDescription)})`
					]
						.filter(Boolean)
						.join(' ')
				)
				.join('. ');
	const weather = latest
		? list(latest['Weather Conditions']).join(', ')
		: stationFresh
			? (station!.Precipitation ?? '').replace(/^No Precipitation$/i, '')
			: '';
	const label =
		status === 'traction'
			? 'Snow or ice: carry chains'
			: status === 'off-season'
				? 'No crew report'
				: STATUS_LABEL[status];
	const updated = Math.max(
		...[latest?.LastUpdated, ...closures.map((c) => c.LastUpdated)].map((t) => (t ? t * 1000 : 0))
	);
	return {
		id: pass.id,
		status,
		label,
		restrictions,
		road,
		weather,
		tempF: stationFresh ? num(station!.AirTemperature) : null,
		advisory: false,
		updated: updated || null,
		...(notices.length && status !== 'closed' ? { notice: notices.join(' ') } : {})
	};
}

const ORDER: PassStatus[] = ['closed', 'chains', 'traction', 'open', 'off-season'];
export const worse = (a: PassStatus, b: PassStatus) =>
	ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;

/**
 * An Idaho 511 or Nevada 511 event that closes a highway now, as a closure on a drive; null for anything else.
 * `by` names the agency (ITD by default) and its 511 site.
 */
export function idahoClosure(
	e: IdahoEvent,
	now = Date.now(),
	by: { source: RoadClosure['source']; link: string } = {
		source: 'ITD',
		link: 'https://511.idaho.gov/'
	}
): RoadClosure | null {
	if (!e.IsFullClosure || !eventInEffect(e, now)) return null;
	// Only state highways: the 511 sites also list county and city streets, which a drive crosses rather than uses.
	if (!/^\s*(I|US|SH|ID|SR|NV)[- ]?\d/i.test(e.RoadwayName ?? '')) return null;
	const [start, end = start] = eventPoints(e);
	if (!start) return null;
	const headline = tidy(e.Description);
	if (!headline) return null;
	return {
		source: by.source,
		headline,
		start,
		end,
		updated: e.LastUpdated ? e.LastUpdated * 1000 : null,
		link: by.link
	};
}

/** An Idaho road weather station's pavement temperature, or null when it has none or is over two hours old. */
export function idahoSurface(
	s: IdahoStation,
	now = Date.now(),
	maxAgeMs = 2 * 3600_000
): SurfaceReading | null {
	const surfaceF = num(s.SurfaceTemperature);
	const at = (num(s.LastUpdated) ?? 0) * 1000;
	const lat = num(s.Latitude);
	const lon = num(s.Longitude);
	if (surfaceF === null || surfaceF < -40 || surfaceF > 160 || !lat || !lon) return null;
	if (!(now - at <= maxAgeMs)) return null;
	return {
		name: (s.Name ?? '').replace(/^D\d\s*-\s*/, '').trim() || 'Road weather station',
		lat,
		lon,
		surfaceF: Math.round(surfaceF),
		airF: num(s.AirTemperature) === null ? null : Math.round(num(s.AirTemperature)!),
		wet: (num(s.Precipitation6H) ?? 0) > 0 || /wet|snow|ice|slush/i.test(s.SurfaceStatus ?? ''),
		at
	};
}
