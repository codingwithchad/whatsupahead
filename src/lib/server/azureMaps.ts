import type { Point } from '../geo';
import type { LatLon } from '../route';
import { COVERAGE, REGIONS } from '../regions';
import { takeMapsRequest, type MapsKind } from './mapsBudget';
import { allow } from './rateLimit';
import { currentVisitor } from './visitor';
import type { DrivingRoute } from './routing';
import type { Suggestion } from './photon';
import type { AzureWaypoint } from '../routeWeather';

// Azure Maps (Microsoft): routing with live traffic and place search, used first when AZURE_MAPS_KEY is set.
// It is paid past a free monthly amount, so the whole app keeps a count per kind of request that survives
// restarts (mapsBudget.ts) and stays inside the free amounts. Past it, or on any error, callers fall back to
// the free services (OSRM, Photon, Nominatim, Open-Meteo).
const API = 'https://atlas.microsoft.com';
const CENTER = {
	lat: ((COVERAGE[1] + COVERAGE[3]) / 2).toFixed(2),
	lon: ((COVERAGE[0] + COVERAGE[2]) / 2).toFixed(2)
};
const ABBR = new Map(REGIONS.map((r) => [r.name, r.abbr]));

export const azureMapsKey = () => process.env.AZURE_MAPS_KEY?.trim() || '';

/**
 * Requests one visitor may cause in an hour, per kind. A normal drive is one route, one weather and a few
 * searches; past this the free services answer for that visitor, so one bot can't use up the day's allowance.
 */
const PER_VISITOR_HOUR: Record<MapsKind, number> = { route: 10, search: 30, weather: 10 };

function spend(kind: MapsKind): boolean {
	const who = currentVisitor();
	if (who && !allow(`azure-maps:${kind}:${who}`, PER_VISITOR_HOUR[kind], 3600_000)) return false;
	return allow(`upstream:azure-maps:${kind}`, 30) && takeMapsRequest(kind);
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
	const url = new URL(path, API);
	url.search = new URLSearchParams({ 'api-version': '1.0', ...params }).toString();
	// The key goes in a header, not the address, so it never lands in a log.
	const res = await fetch(url, {
		headers: { 'subscription-key': azureMapsKey() },
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) {
		const reason = await res
			.json()
			.then((b: { error?: { message?: string } }) => b.error?.message ?? '')
			.catch(() => '');
		throw new Error(`azure maps ${res.status} ${reason.slice(0, 160)}`.trim());
	}
	return (await res.json()) as T;
}

/**
 * The weather at each point when you get there: one request for the whole drive. Each stop is a point and the
 * minutes from now until you reach it (Azure allows up to 60 points and 120 hours).
 */
export async function azureWeatherAlongRoute(
	stops: { lat: number; lon: number; minutesIn: number }[]
): Promise<AzureWaypoint[]> {
	if (!spend('weather')) throw new Error('daily allowance used');
	const body = await get<{ waypoints?: AzureWaypoint[] }>('/weather/route/json', {
		'api-version': '1.1',
		query: stops
			.map((s) => `${s.lat.toFixed(4)},${s.lon.toFixed(4)},${Math.max(0, Math.round(s.minutesIn))}`)
			.join(':'),
		language: 'en-US'
	});
	if (body.waypoints?.length !== stops.length)
		throw new Error('weather along route: wrong number of points');
	return body.waypoints;
}

interface AzureRoute {
	summary: { lengthInMeters: number; travelTimeInSeconds: number };
	legs: { points: { latitude: number; longitude: number }[] }[];
}

/** Driving route through the stops in order, timed with current traffic. */
export async function azureRoute(stops: Point[]): Promise<DrivingRoute> {
	if (!spend('route')) throw new Error('daily allowance used');
	const body = await get<{ routes?: AzureRoute[] }>('/route/directions/json', {
		query: stops.map((p) => `${p.lat},${p.lon}`).join(':'),
		travelMode: 'car',
		traffic: 'true',
		// Forest and dirt roads are where GPS detours strand drivers in winter.
		avoid: 'unpavedRoads'
	});
	const route = body.routes?.[0];
	if (!route) throw new Error('no route');
	return toRoute(route);
}

export function toRoute(route: AzureRoute): DrivingRoute {
	const coords: LatLon[] = [];
	for (const leg of route.legs)
		for (const p of leg.points)
			coords.push([Math.round(p.latitude * 1e5) / 1e5, Math.round(p.longitude * 1e5) / 1e5]);
	return {
		coords,
		miles: route.summary.lengthInMeters / 1609.344,
		minutes: route.summary.travelTimeInSeconds / 60
	};
}

interface AzureResult {
	type: string;
	poi?: { name?: string };
	address?: {
		streetNumber?: string;
		streetName?: string;
		municipality?: string;
		countrySecondarySubdivision?: string;
		countrySubdivision?: string;
		countrySubdivisionName?: string;
		postalCode?: string;
		freeformAddress?: string;
	};
	position?: { lat: number; lon: number };
}

export function toSuggestion(r: AzureResult): Suggestion | null {
	const a = r.address ?? {};
	if (typeof r.position?.lat !== 'number' || typeof r.position?.lon !== 'number') return null;
	const street = [a.streetNumber, a.streetName].filter(Boolean).join(' ');
	const label =
		r.poi?.name ??
		(r.type === 'Geography'
			? (a.municipality ?? a.postalCode ?? a.countrySecondarySubdivision)
			: street || a.freeformAddress);
	if (!label) return null;
	const state =
		a.countrySubdivision ?? (a.countrySubdivisionName && ABBR.get(a.countrySubdivisionName)) ?? '';
	const where = label === a.municipality ? '' : (a.municipality ?? '');
	return {
		label,
		sub: [where, state].filter(Boolean).join(', '),
		lat: r.position.lat,
		lon: r.position.lon
	};
}

/** Places matching the text, nearest the covered regions first. `typing` asks for partial-word matches. */
export async function azureSearch(query: string, limit = 5, typing = false): Promise<Suggestion[]> {
	const q = query.trim().slice(0, 120);
	if (q.length < 2) return [];
	if (!spend('search')) throw new Error('daily allowance used');
	const body = await get<{ results?: AzureResult[] }>('/search/fuzzy/json', {
		query: q,
		countrySet: 'US',
		lat: CENTER.lat,
		lon: CENTER.lon,
		limit: String(limit + 3),
		typeahead: String(typing),
		language: 'en-US'
	});
	const seen = new Set<string>();
	const out: Suggestion[] = [];
	for (const r of body.results ?? []) {
		const s = toSuggestion(r);
		if (!s) continue;
		const key = `${s.label}|${s.sub}`.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(s);
		if (out.length >= limit) break;
	}
	return out;
}
