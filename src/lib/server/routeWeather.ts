import {
	fromAzure,
	fromOpenMeteo,
	type OpenMeteoHourly,
	type RouteStop,
	type RouteWeather
} from '../routeWeather';
import { azureMapsKey, azureWeatherAlongRoute } from './azureMaps';
import { cached } from './cache';
import { forecastAt } from './openMeteo';

/**
 * The weather at each stop for the time you'll be there. Azure Maps' Weather Along Route when it is set up (one
 * request for the whole drive), otherwise Open-Meteo's free hourly forecast. Null when neither answers, so the
 * trip page just leaves it out.
 */
export async function weatherOnTheWay(
	stops: RouteStop[],
	{ free = false }: { free?: boolean } = {}
): Promise<RouteWeather | null> {
	if (stops.length < 2) return null;
	// Same drive, same 10 minutes: same answer. (`free` is for refreshes while driving: Azure Maps' monthly
	// weather allowance could not cover a request every few minutes, so those always use Open-Meteo.)
	const key = `route-wx${free ? '-free' : ''}:${Math.floor(Date.now() / 600_000)}:${stops
		.map((s) => `${s.lat.toFixed(2)},${s.lon.toFixed(2)},${Math.round(s.minutesIn / 10)}`)
		.join(';')}`;
	try {
		return await cached(key, 10 * 60 * 1000, async () => {
			if (azureMapsKey() && !free) {
				try {
					const points = await azureWeatherAlongRoute(stops);
					return { source: 'Azure Maps', stops: stops.map((s, i) => fromAzure(s, points[i])) };
				} catch (err) {
					console.warn(`[route-weather] azure maps: ${(err as Error).message}; using open-meteo`);
				}
			}
			return { source: 'Open-Meteo', stops: await openMeteo(stops) };
		});
	} catch (err) {
		console.warn(`[route-weather] ${(err as Error).message}`);
		return null;
	}
}

async function openMeteo(stops: RouteStop[]) {
	// Passes are forecast at their summit's height (see forecastAt).
	const list = await forecastAt<{ hourly: OpenMeteoHourly }>(
		stops.map((s) => ({
			lat: s.lat,
			lon: s.lon,
			feet: s.kind === 'pass' ? s.elevation_ft : undefined
		})),
		{
			hourly: 'temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,snowfall,precipitation',
			temperature_unit: 'fahrenheit',
			wind_speed_unit: 'mph',
			precipitation_unit: 'inch',
			timezone: 'GMT',
			forecast_days: '3'
		}
	);
	const now = Date.now();
	const out = stops.map((s, i) => (list[i] ? fromOpenMeteo(s, list[i].hourly, now) : null));
	if (out.some((x) => !x)) throw new Error('open-meteo: missing hours');
	return out as NonNullable<(typeof out)[number]>[];
}
