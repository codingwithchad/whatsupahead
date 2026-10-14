import { openMeteoAllowed } from './rateLimit';

const FEET_PER_METER = 3.28084;

/** A point to forecast; `feet` when its height is known exactly (a pass summit). */
export interface ForecastPoint {
	lat: number;
	lon: number;
	feet?: number;
}

/**
 * Open-Meteo's free forecast for many points, in the order given. Open-Meteo adjusts each forecast for the ground
 * height at the point, read from a 90 m terrain map, which can land beside a road summit rather than on it (the
 * slope next to Snoqualmie Pass, not the 3,022 ft summit). So points with a known height are asked for separately,
 * at that height; Open-Meteo takes heights for every point in a request or for none.
 */
export async function forecastAt<T>(
	points: ForecastPoint[],
	params: Record<string, string>
): Promise<T[]> {
	const known = points.flatMap((p, i) => (p.feet ? [i] : []));
	const rest = points.flatMap((p, i) => (p.feet ? [] : [i]));
	const out: T[] = new Array(points.length);
	await Promise.all(
		[rest, known]
			.filter((group) => group.length)
			.map(async (group) => {
				const list = await request<T>(
					group.map((i) => points[i]),
					params,
					group === known
				);
				group.forEach((i, k) => (out[i] = list[k]));
			})
	);
	return out;
}

async function request<T>(
	points: ForecastPoint[],
	params: Record<string, string>,
	withHeights: boolean
): Promise<T[]> {
	if (!openMeteoAllowed()) throw new Error('open-meteo busy');
	const url = new URL('https://api.open-meteo.com/v1/forecast');
	url.searchParams.set('latitude', points.map((p) => p.lat.toFixed(3)).join(','));
	url.searchParams.set('longitude', points.map((p) => p.lon.toFixed(3)).join(','));
	if (withHeights)
		url.searchParams.set(
			'elevation',
			points.map((p) => ((p.feet ?? 0) / FEET_PER_METER).toFixed(1)).join(',')
		);
	for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
	const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
	if (!res.ok) throw new Error(`open-meteo ${res.status}`);
	const body = (await res.json()) as T | T[];
	const list = Array.isArray(body) ? body : [body];
	if (list.length !== points.length) throw new Error('open-meteo returned the wrong count');
	return list;
}
