import { parseDotNetDate } from './transit';

export type PassStatus = 'closed' | 'chains' | 'traction' | 'open' | 'off-season';

export interface Restriction {
	direction: string;
	text: string;
}

/** One report as WSDOT's Mountain Pass Conditions service returns it (the fields we use). */
export interface RawPass {
	MountainPassId: number;
	MountainPassName: string;
	ElevationInFeet?: number;
	Latitude?: number;
	Longitude?: number;
	DateUpdated?: string;
	RoadCondition?: string | null;
	WeatherCondition?: string | null;
	TemperatureInFahrenheit?: number | null;
	TravelAdvisoryActive?: boolean;
	RestrictionOne?: { RestrictionText?: string | null; TravelDirection?: string | null } | null;
	RestrictionTwo?: { RestrictionText?: string | null; TravelDirection?: string | null } | null;
}

export interface PassReport {
	/** WSDOT's pass number, or our pass id for Oregon and California. */
	id: number | string;
	status: PassStatus;
	label: string;
	restrictions: Restriction[];
	road: string;
	weather: string;
	tempF: number | null;
	advisory: boolean;
	updated: number | null;
}

export const STATUS_LABEL: Record<PassStatus, string> = {
	closed: 'Closed',
	chains: 'Chains required',
	traction: 'Traction tires advised',
	open: 'Open',
	// WSDOT has stopped its hand-written reports for the season (usually April to November). No report is
	// not the same as open: say only what we know, and point to the cameras.
	'off-season': 'No report yet'
};

// Worst first: this is how two directions are combined.
const SEVERITY: PassStatus[] = ['closed', 'chains', 'traction', 'open', 'off-season'];

const OFF_SEASON =
	/reports? (have|has) ended|not reporting|no current information|reporting (season|period)|traditionally .{0,40}(reported|conditions)|reported (on this page )?from/i;

/** What one restriction line means. WSDOT writes these by hand, so match the common wordings. */
export function classifyRestriction(text: string): PassStatus {
	const t = text.trim();
	if (!t || /^no current information/i.test(t)) return 'off-season';
	if (/\bclosed\b/i.test(t) && !/reopen|not closed/i.test(t)) return 'closed';
	if (/chains?\b/i.test(t) && !/no chains?|chains? (are )?not (required|needed)/i.test(t))
		return 'chains';
	if (/traction|snow tires?|tire advisory|advised/i.test(t) && !/^no restrictions/i.test(t))
		return 'traction';
	if (/^no restrictions/i.test(t)) return 'open';
	return 'open';
}

// A report this old is history, not the road today (WSDOT updates live reports many times a day in season).
const STALE_MS = 3 * 24 * 60 * 60 * 1000;

/** `now` is a named option, so `.map(classifyPass)` (which would pass the index as the time) doesn't type-check. */
export function classifyPass(
	raw: RawPass,
	{ now = Date.now() }: { now?: number } = {}
): PassReport {
	const restrictions = [raw.RestrictionOne, raw.RestrictionTwo]
		.filter((r): r is NonNullable<typeof r> => Boolean(r?.RestrictionText?.trim()))
		.map((r) => ({ direction: r.TravelDirection?.trim() ?? '', text: r.RestrictionText!.trim() }));
	const road = (raw.RoadCondition ?? '').replace(/\s+/g, ' ').trim();

	// Worst of the two directions.
	let status =
		restrictions
			.map((r) => classifyRestriction(r.text))
			.sort((a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b))[0] ?? 'off-season';

	// The road report can say the pass is closed even when the restriction lines are blank or generic.
	if (
		status !== 'closed' &&
		/\b(is|are|remains?|currently|now)\s+closed\b/i.test(road) &&
		!/reopen|re-open/i.test(road)
	)
		status = 'closed';
	// Reporting has stopped for the season: the "No restrictions" lines are not live information.
	if (status === 'open' && OFF_SEASON.test(road)) status = 'off-season';
	if (
		status === 'off-season' &&
		!OFF_SEASON.test(road) &&
		restrictions.length &&
		restrictions.every((r) => /^no restrictions/i.test(r.text))
	)
		status = 'open';

	// An old "open" or "chains" is not today's road. A closure stays shown: it is safer to send people to check.
	const updated = raw.DateUpdated ? parseDotNetDate(raw.DateUpdated) : null;
	let label = STATUS_LABEL[status];
	if (
		updated !== null &&
		now - updated > STALE_MS &&
		status !== 'closed' &&
		status !== 'off-season'
	) {
		status = 'off-season';
		label = 'No recent report';
	}

	return {
		id: raw.MountainPassId,
		status,
		label,
		restrictions,
		road,
		weather: (raw.WeatherCondition ?? '').trim(),
		tempF: raw.TemperatureInFahrenheit ?? null,
		advisory: Boolean(raw.TravelAdvisoryActive),
		updated
	};
}

// ---- Oregon (ODOT TripCheck) and California (Caltrans) ----------------------------------------------------
// Neither state writes one report per pass the way WSDOT does. ODOT's crews file road-and-weather reports for
// stretches of highway, and Caltrans posts chain-control status at checkpoints and full closures as lane
// closures. A pass's report is built from the ones on its highway near the summit.

/** Where a non-WSDOT pass gets its report: the state's feed, the highway as that feed writes it, how far to look. */
export interface PassReportSource {
	source: 'odot' | 'caltrans';
	route: string;
	radius_km?: number;
	/** Caltrans districts the pass's checkpoints are in, so the server fetches only what it needs. */
	districts?: number[];
	/**
	 * Also look for full closures in Caltrans's lane-closure list. Off for districts where that list is huge
	 * (Los Angeles is about 12 MB) and winter closures are rare.
	 */
	closures?: boolean;
}

interface Pt {
	lat: number;
	lon: number;
}

const DEFAULT_RADIUS_KM = 15;
const sameRoute = (a: string | undefined, b: string) =>
	(a ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') === b.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Distance in km from a point to the straight line between two others (a report that covers a stretch). */
export function kmToStretch(p: Pt, a: Pt, b: Pt = a): number {
	const k = Math.cos((p.lat * Math.PI) / 180) * 111.32;
	const [ax, ay, bx, by, px, py] = [
		a.lon * k,
		a.lat * 110.57,
		b.lon * k,
		b.lat * 110.57,
		p.lon * k,
		p.lat * 110.57
	];
	const dx = bx - ax;
	const dy = by - ay;
	const len = dx * dx + dy * dy;
	const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Labels beyond STATUS_LABEL that Oregon and California reports use, and the colour each gets. */
export const EXTRA_LABELS: Record<string, PassStatus> = {
	'No chain controls': 'open',
	'Carry chains or traction tires': 'traction',
	'No recent report': 'off-season',
	'Usually closed in winter': 'off-season'
};
export const toneOf = (label: string): PassStatus | undefined =>
	EXTRA_LABELS[label] ??
	(Object.entries(STATUS_LABEL).find(([, l]) => l === label)?.[0] as PassStatus | undefined);

const worst = (a: PassStatus, b: PassStatus) =>
	SEVERITY.indexOf(a) <= SEVERITY.indexOf(b) ? a : b;

/** One ODOT road-and-weather report (the fields we use). */
export interface OdotRwReport {
	'entry-time'?: string;
	'expiry-time'?: string;
	location?: {
		'location-name'?: string;
		'route-id'?: string;
		'start-location'?: { 'start-lat'?: number; 'start-long'?: number };
		'end-location'?: { 'end-lat'?: number; 'end-long'?: number };
	};
	'air-temperature'?: number | null;
	'adjacent-snow-depth'?: number | null;
	'weather-conditions'?: { 'weather-id'?: number };
	'road-conditions'?: { 'road-cond-id'?: number };
	'driving-restriction'?: { 'restriction-id'?: string };
	comments?: string | null;
}

/** One ODOT incident (the fields we use); impact 4 is a closure. */
export interface OdotIncident {
	'is-active'?: string;
	'impact-id'?: string;
	headline?: string;
	'update-time'?: string;
	location?: {
		'route-id'?: string;
		'start-location'?: { 'start-lat'?: number; 'start-long'?: number };
		'end-location'?: { 'end-lat'?: number; 'end-long'?: number };
	};
}

// From ODOT's /RW/Metadata.
const ODOT_WEATHER: Record<number, string> = {
	1: 'Clear',
	2: 'Partly cloudy',
	3: 'Overcast',
	4: 'Ground fog',
	5: 'Showers',
	6: 'Rain',
	7: 'Snow flurries',
	8: 'Heavy snow',
	9: 'Severe weather alert',
	91: 'Freezing rain',
	92: 'High winds',
	93: 'Whiteout',
	94: 'Dust storm',
	95: 'Falling trees'
};
const ODOT_ROAD: Record<number, string> = {
	1: 'Bare pavement',
	2: 'Spots of ice',
	3: 'Black ice',
	4: 'Standing water',
	5: 'Snow pack breaking up',
	6: 'Packed snow'
};
const ODOT_RESTRICTION: Record<string, string> = {
	A: 'Carry chains or traction tires',
	B: 'Chains required on vehicles towing or over 10,000 GVW',
	B1: 'Chains required on vehicles towing or single drive axle over 10,000 GVW',
	C: 'Chains required. Traction tires allowed in place of chains on vehicles under 10,000 GVW and not towing',
	D: 'Chains required. Traction tires alone are not enough'
};

const stretch = (l: OdotRwReport['location'] | OdotIncident['location']) => {
	const s = l?.['start-location'];
	const e = l?.['end-location'];
	if (typeof s?.['start-lat'] !== 'number' || typeof s?.['start-long'] !== 'number') return null;
	const a = { lat: s['start-lat'], lon: s['start-long'] };
	const b =
		typeof e?.['end-lat'] === 'number' && typeof e?.['end-long'] === 'number' && e['end-lat']
			? { lat: e['end-lat'], lon: e['end-long'] as number }
			: a;
	return [a, b] as const;
};
const near = (p: Pt, l: OdotRwReport['location'], km: number) => {
	const s = stretch(l);
	return s !== null && kmToStretch(p, s[0], s[1]) <= km;
};
const time = (s?: string) => (s ? Date.parse(s) || null : null);

const empty = (id: string, label = STATUS_LABEL['off-season']): PassReport => ({
	id,
	status: 'off-season',
	label,
	restrictions: [],
	road: '',
	weather: '',
	tempF: null,
	advisory: false,
	updated: null
});

/** An Oregon pass's report from ODOT's crew reports and closures near its summit. */
export function odotPassReport(
	pass: Pt & { id: string; report: PassReportSource },
	reports: OdotRwReport[],
	incidents: OdotIncident[],
	{ now = Date.now() }: { now?: number } = {}
): PassReport {
	const km = pass.report.radius_km ?? DEFAULT_RADIUS_KM;
	const onRoute = <T extends { location?: { 'route-id'?: string } }>(x: T) =>
		sameRoute(x.location?.['route-id'], pass.report.route);
	const closures = incidents.filter(
		(i) =>
			i['is-active'] !== 'false' &&
			i['impact-id'] === '4' &&
			onRoute(i) &&
			!/\bramps?\b|\blanes?\b|shoulder/i.test(i.headline ?? '') &&
			near(pass, i.location, km)
	);
	const live = reports
		.filter((r) => onRoute(r) && near(pass, r.location, km))
		.filter((r) => (time(r['expiry-time']) ?? Infinity) > now)
		.sort((a, b) => (time(b['entry-time']) ?? 0) - (time(a['entry-time']) ?? 0));
	if (!closures.length && !live.length) return empty(pass.id);

	let status: PassStatus = live.length ? 'open' : 'closed';
	const restrictions: Restriction[] = [];
	for (const r of live) {
		const id = (r['driving-restriction']?.['restriction-id'] ?? '0').toUpperCase();
		const text = ODOT_RESTRICTION[id];
		if (!text) continue;
		status = worst(status, id === 'A' ? 'traction' : 'chains');
		restrictions.push({ direction: titleWords(r.location?.['location-name'] ?? ''), text });
	}
	const latest = live[0];
	const roadCond = ODOT_ROAD[latest?.['road-conditions']?.['road-cond-id'] ?? 0];
	const depth = latest?.['adjacent-snow-depth'];
	const road = closures.length
		? (closures[0].headline ?? '').trim()
		: [roadCond, depth ? `${depth} in of snow beside the road` : null, latest?.comments?.trim()]
				.filter(Boolean)
				.join('. ');
	if (closures.length) status = 'closed';
	const label = status === 'traction' ? 'Carry chains or traction tires' : STATUS_LABEL[status];
	return {
		id: pass.id,
		status,
		label,
		restrictions,
		road,
		weather: ODOT_WEATHER[latest?.['weather-conditions']?.['weather-id'] ?? 0] ?? '',
		tempF: typeof latest?.['air-temperature'] === 'number' ? latest['air-temperature'] : null,
		advisory: false,
		updated: time(latest?.['entry-time']) ?? time(closures[0]?.['update-time'])
	};
}

const titleWords = (s: string) =>
	s
		.toLowerCase()
		.replace(/\b[a-z]/g, (c) => c.toUpperCase())
		.trim();

/** One Caltrans chain-control checkpoint (the fields we use). */
export interface CaltransChainControl {
	location: {
		locationName?: string;
		latitude: string;
		longitude: string;
		route?: string;
		direction?: string;
	};
	inService?: string;
	statusData?: {
		status?: string;
		statusDescription?: string;
		statusTimestamp?: { statusDate?: string; statusTime?: string };
	};
}

/** One Caltrans lane closure (the fields we use). */
export interface CaltransClosure {
	location: {
		begin: {
			beginLatitude: string;
			beginLongitude: string;
			beginRoute?: string;
			beginFreeFormDescription?: string;
			beginLocationName?: string;
		};
		end: {
			endLatitude: string;
			endLongitude: string;
			endFreeFormDescription?: string;
			endLocationName?: string;
		};
	};
	closure: {
		facility?: string;
		typeOfClosure?: string;
		typeOfWork?: string;
		closureTimestamp?: { closureStartEpoch?: string; closureEndEpoch?: string };
		code1097?: { isCode1097?: string };
		code1098?: { isCode1098?: string };
	};
}

/** "Foot of Conway / 8 Mi. N of Lee Vining _ _ _ (17)7" -> "Foot of Conway / 8 Mi. N of Lee Vining". */
export function checkpointName(raw: string): string {
	const name = raw
		.replace(/(\s*_)+.*$/, '')
		.replace(/\s+/g, ' ')
		.trim();
	return name === name.toUpperCase() && /[A-Z]{3}/.test(name) ? titleWords(name) : name;
}

const CHAIN_LEVEL: Record<string, string> = {
	'R-1': 'Chains required. Snow tires allowed on vehicles under 6,000 lb',
	'R-2': 'Chains required. Four-wheel drive with snow tires on all four wheels allowed',
	'R-3': 'Chains required on all vehicles'
};

/** Is Caltrans's full closure in effect right now (crews on the road, not yet ended)? */
export function closureInEffect(c: CaltransClosure, now = Date.now()): boolean {
	const t = c.closure.closureTimestamp;
	const start = Number(t?.closureStartEpoch) * 1000;
	const end = Number(t?.closureEndEpoch) * 1000;
	return (
		c.closure.typeOfClosure === 'Full' &&
		/^(Mainline|Conventional Hwy)$/.test(c.closure.facility ?? '') &&
		c.closure.code1097?.isCode1097 === 'true' &&
		c.closure.code1098?.isCode1098 !== 'true' &&
		(!start || start <= now) &&
		(!end || end >= now)
	);
}

const winterMonth = (now: number) => {
	const m = new Date(now).getUTCMonth();
	return m >= 11 || m <= 3; // December through April
};

/** A California pass's report from Caltrans chain controls and full closures near its summit. */
export function caltransPassReport(
	pass: Pt & { id: string; report: PassReportSource; winter_closure?: string },
	controls: CaltransChainControl[],
	closures: CaltransClosure[],
	{ now = Date.now() }: { now?: number } = {}
): PassReport {
	const km = pass.report.radius_km ?? DEFAULT_RADIUS_KM;
	const pt = (lat: string, lon: string) => ({ lat: Number(lat), lon: Number(lon) });
	const closed = closures.filter((c) => {
		const b = c.location.begin;
		const e = c.location.end;
		return (
			closureInEffect(c, now) &&
			sameRoute(b.beginRoute, pass.report.route) &&
			kmToStretch(pass, pt(b.beginLatitude, b.beginLongitude), pt(e.endLatitude, e.endLongitude)) <=
				km
		);
	});
	const points = controls.filter(
		(c) =>
			c.inService !== 'false' &&
			sameRoute(c.location.route, pass.report.route) &&
			/^R-\d$/.test(c.statusData?.status ?? '') &&
			kmToStretch(pass, pt(c.location.latitude, c.location.longitude)) <= km
	);
	const stamp = (c: CaltransChainControl) => {
		const s = c.statusData?.statusTimestamp;
		return s?.statusDate
			? Date.parse(`${s.statusDate}T${s.statusTime ?? '00:00:00'}-08:00`) || null
			: null;
	};
	const active = points.filter((c) => CHAIN_LEVEL[c.statusData!.status!]);

	if (closed.length) {
		const c = closed[0];
		const from = c.location.begin.beginLocationName || c.location.begin.beginFreeFormDescription;
		const to = c.location.end.endLocationName || c.location.end.endFreeFormDescription;
		return {
			...empty(pass.id),
			status: 'closed',
			label: STATUS_LABEL.closed,
			road: [
				from && to && from !== to ? `Closed from ${from} to ${to}` : 'Closed',
				c.closure.typeOfWork
			]
				.filter(Boolean)
				.join('. '),
			updated: Number(c.closure.closureTimestamp?.closureStartEpoch) * 1000 || null
		};
	}
	if (active.length) {
		// Highest level first (R-3 is the strictest).
		active.sort((a, b) => b.statusData!.status!.localeCompare(a.statusData!.status!));
		const seen = new Set<string>();
		return {
			...empty(pass.id),
			status: 'chains',
			label: STATUS_LABEL.chains,
			restrictions: active
				.filter((c) => {
					const key = `${c.location.direction}|${c.statusData!.status}`;
					return !seen.has(key) && seen.add(key);
				})
				.map((c) => ({
					direction: [
						c.location.direction ? `${c.location.direction}bound` : '',
						checkpointName(c.location.locationName ?? '')
					]
						.filter(Boolean)
						.join(' at '),
					text: CHAIN_LEVEL[c.statusData!.status!]
				})),
			updated: Math.max(...active.map((c) => stamp(c) ?? 0)) || null
		};
	}
	// Caltrans may not list a seasonal closure as a lane closure: in deep winter, don't call these roads open.
	if (pass.winter_closure && winterMonth(now)) return empty(pass.id, 'Usually closed in winter');
	if (!points.length) return empty(pass.id);
	// "No chain controls" stands until Caltrans changes it: its date is when that was set, not a fresh reading.
	return { ...empty(pass.id), status: 'open', label: 'No chain controls' };
}
