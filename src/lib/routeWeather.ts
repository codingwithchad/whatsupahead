import type { Point } from './geo';
import { alongRoute, cumulativeMiles, type LatLon } from './route';

// Weather on the way: the forecast at the start, at each pass the drive crosses, every hour or so on a long
// drive, and at the destination, each for the time you will actually be there (leaving time plus the driving
// time to that point), not the weather now.

export type StopKind = 'start' | 'pass' | 'way' | 'end';

export interface RouteStop {
	kind: StopKind;
	label: string;
	lat: number;
	lon: number;
	/** Miles from the start along the road. */
	along: number;
	/** Minutes from now until you are there. */
	minutesIn: number;
	elevation_ft?: number;
	/** The place page for a pass. */
	place?: string;
}

export type Precip = 'rain' | 'snow' | 'ice' | 'mix';

export interface StopWeather extends RouteStop {
	/** "Light snow", "Mostly cloudy". */
	phrase: string;
	tempF: number | null;
	precip: Precip | null;
	windMph: number | null;
	gustMph: number | null;
	/** 0 none, 1 low, 2 moderate, 3 high, 4 extreme (Azure Maps' scale; Open-Meteo is mapped onto it). */
	hazard: number;
	/** The hazards that make up `hazard`, worst first, e.g. ["Heavy snow", "Strong winds"]. */
	hazards: string[];
}

export interface RouteWeather {
	stops: StopWeather[];
	source: 'Azure Maps' | 'Open-Meteo';
}

const MAX_STOPS = 12;
/** On a long drive, a forecast at least this often (minutes), so a 5-hour drive is not just two ends. */
const EVERY_MINUTES = 60;

/**
 * Where to forecast: start, passes within a couple of miles of the road (in the order you reach them), a point
 * every hour or so where there is nothing else, and the end. `nameNear` labels those in-between points.
 */
export function routeStops(
	route: LatLon[],
	minutes: number,
	leaveIn: number,
	ends: { from: Point & { label: string }; to: Point & { label: string } },
	passes: (Point & { name: string; elevation_ft?: number; place?: string })[],
	nameNear: (p: Point) => string | null = () => null
): RouteStop[] {
	const cum = cumulativeMiles(route);
	const total = cum[cum.length - 1] || 0.1;
	const when = (along: number) => leaveIn + (minutes * Math.min(along, total)) / total;
	const at = (along: number) => {
		let j = 0;
		while (j < cum.length - 1 && cum[j] < along) j++;
		return { lat: route[j][0], lon: route[j][1] };
	};
	const stops: RouteStop[] = [
		{ kind: 'start', label: ends.from.label, ...at(0), along: 0, minutesIn: when(0) }
	];
	for (const p of alongRoute(passes, route, { corridor: 2, destinationRadius: 0 }))
		if (p.along > 1 && p.along < total - 1)
			stops.push({
				kind: 'pass',
				label: p.item.name,
				lat: p.item.lat,
				lon: p.item.lon,
				along: p.along,
				minutesIn: when(p.along),
				elevation_ft: p.item.elevation_ft,
				place: p.item.place
			});
	stops.push({
		kind: 'end',
		label: ends.to.label,
		...at(total),
		along: total,
		minutesIn: when(total)
	});
	stops.sort((a, b) => a.along - b.along);

	// Fill long gaps with a point every hour or so.
	const filled: RouteStop[] = [];
	for (const [i, s] of stops.entries()) {
		const prev = stops[i - 1];
		if (prev) {
			const gap = s.minutesIn - prev.minutesIn;
			const extra = Math.ceil(gap / EVERY_MINUTES) - 1;
			for (let k = 1; k <= extra && gap > EVERY_MINUTES * 1.25; k++) {
				const along = prev.along + ((s.along - prev.along) * k) / (extra + 1);
				const p = at(along);
				const town = nameNear(p);
				filled.push({
					kind: 'way',
					label: town ? `Near ${town}` : `Mile ${Math.round(along)}`,
					...p,
					along,
					minutesIn: when(along)
				});
			}
		}
		filled.push(s);
	}
	// Keep the ends and the passes when there are too many; drop in-between points first.
	while (filled.length > MAX_STOPS) {
		const i = filled.findIndex((s) => s.kind === 'way');
		filled.splice(i === -1 ? filled.length - 2 : i, 1);
	}
	return filled;
}

// ---- Azure Maps: Weather Along Route ------------------------------------------------------------------------

export interface AzureWaypoint {
	shortPhrase?: string;
	temperature?: { value: number; unit: string };
	wind?: { speed?: { value: number; unit: string } };
	windGust?: { speed?: { value: number; unit: string } };
	precipitation?: { dbz?: number; type?: string };
	hazards?: {
		maxHazardIndex?: number;
		hazardDetails?: { hazardIndex: number; shortPhrase?: string }[];
	};
}

const toF = (t?: { value: number; unit: string }) =>
	t ? Math.round(t.unit === 'F' ? t.value : (t.value * 9) / 5 + 32) : null;
const toMph = (s?: { value: number; unit: string }) =>
	s ? Math.round(/mi/.test(s.unit) ? s.value : s.value / 1.609) : null;
const PRECIP: Record<string, Precip> = { RAIN: 'rain', SNOW: 'snow', ICE: 'ice', MIX: 'mix' };

export function fromAzure(stop: RouteStop, w: AzureWaypoint): StopWeather {
	const falling = (w.precipitation?.dbz ?? 0) > 0;
	return {
		...stop,
		phrase: w.shortPhrase ?? '',
		tempF: toF(w.temperature),
		precip: falling ? (PRECIP[w.precipitation?.type ?? ''] ?? null) : null,
		windMph: toMph(w.wind?.speed),
		gustMph: toMph(w.windGust?.speed),
		hazard: w.hazards?.maxHazardIndex ?? 0,
		hazards: (w.hazards?.hazardDetails ?? [])
			.slice()
			.sort((a, b) => b.hazardIndex - a.hazardIndex)
			.map((h) => h.shortPhrase ?? '')
			.filter(Boolean)
	};
}

// ---- Open-Meteo (free, no key): the hour you get there --------------------------------------------------------

export interface OpenMeteoHourly {
	time: string[];
	temperature_2m: number[];
	weather_code: number[];
	wind_speed_10m: number[];
	wind_gusts_10m: number[];
	snowfall: number[];
	precipitation: number[];
}

// WMO weather codes, as Open-Meteo uses them.
const WMO: Record<number, [string, Precip | null]> = {
	0: ['Clear', null],
	1: ['Mostly clear', null],
	2: ['Partly cloudy', null],
	3: ['Cloudy', null],
	45: ['Fog', null],
	48: ['Freezing fog', 'ice'],
	51: ['Light drizzle', 'rain'],
	53: ['Drizzle', 'rain'],
	55: ['Heavy drizzle', 'rain'],
	56: ['Freezing drizzle', 'ice'],
	57: ['Freezing drizzle', 'ice'],
	61: ['Light rain', 'rain'],
	63: ['Rain', 'rain'],
	65: ['Heavy rain', 'rain'],
	66: ['Freezing rain', 'ice'],
	67: ['Freezing rain', 'ice'],
	71: ['Light snow', 'snow'],
	73: ['Snow', 'snow'],
	75: ['Heavy snow', 'snow'],
	77: ['Snow grains', 'snow'],
	80: ['Rain showers', 'rain'],
	81: ['Rain showers', 'rain'],
	82: ['Heavy rain showers', 'rain'],
	85: ['Snow showers', 'snow'],
	86: ['Heavy snow showers', 'snow'],
	95: ['Thunderstorms', 'rain'],
	96: ['Thunderstorms with hail', 'ice'],
	99: ['Thunderstorms with hail', 'ice']
};

/** The forecast hour you'll be there (Open-Meteo hours are GMT, "2026-12-10T15:00"). */
export function fromOpenMeteo(
	stop: RouteStop,
	h: OpenMeteoHourly,
	now = Date.now()
): StopWeather | null {
	const target = now + stop.minutesIn * 60_000;
	const i = h.time.findIndex((t) => Date.parse(`${t}:00Z`) + 3_600_000 > target);
	if (i === -1) return null;
	const [phrase, precip] = WMO[h.weather_code[i]] ?? ['', null];
	const gust = Math.round(h.wind_gusts_10m[i]);
	const snow = h.snowfall[i];
	const hazards: [number, string][] = [];
	if (precip === 'ice') hazards.push([3, 'Ice']);
	if (snow >= 1) hazards.push([3, 'Heavy snow']);
	else if (snow > 0.2) hazards.push([2, 'Snow']);
	else if (snow > 0) hazards.push([1, 'Light snow']);
	if (gust >= 45) hazards.push([3, 'Strong winds']);
	else if (gust >= 30) hazards.push([2, 'Gusty winds']);
	if (h.precipitation[i] >= 0.3 && precip === 'rain') hazards.push([2, 'Heavy rain']);
	hazards.sort((a, b) => b[0] - a[0]);
	return {
		...stop,
		phrase,
		tempF: Math.round(h.temperature_2m[i]),
		precip,
		windMph: Math.round(h.wind_speed_10m[i]),
		gustMph: gust,
		hazard: hazards[0]?.[0] ?? 0,
		hazards: hazards.map(([, t]) => t)
	};
}

/** One line for the drive: the worst stop, or that it looks fine. */
export function headline(stops: StopWeather[]): string {
	const worst = stops.reduce<StopWeather | null>(
		(w, s) => (s.hazard > (w?.hazard ?? 0) ? s : w),
		null
	);
	if (!worst || worst.hazard < 2) {
		const snowy = stops.find((s) => s.precip === 'snow' || s.precip === 'ice');
		return snowy
			? `${snowy.phrase || 'Snow'} possible at ${snowy.label} when you get there.`
			: 'No weather trouble expected on the way.';
	}
	return `${worst.hazards[0] ?? worst.phrase} expected at ${worst.label} when you get there.`;
}
