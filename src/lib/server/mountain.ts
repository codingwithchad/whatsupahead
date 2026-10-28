import {
	avalancheAt,
	roadStation,
	snowReading,
	type AvalancheDanger,
	type AvalancheZone,
	type AwdbSeries,
	type SnotelStation,
	type SnowReading
} from '../mountain';
import type { PassInfo } from '../types';
import { cached } from './cache';

const AWDB = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1';
const AVALANCHE = 'https://api.avalanche.org/v2/public/products/map-layer';
const USER_AGENT = 'WhatsUpAhead (https://github.com/codingwithchad/whatsupahead)';
const HOUR = 3600_000;

async function getJson<T>(url: string): Promise<T> {
	const res = await fetch(url, {
		headers: { 'User-Agent': USER_AGENT },
		signal: AbortSignal.timeout(10000)
	});
	if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
	return (await res.json()) as T;
}

/** SNOTEL stations in the states we cover, refreshed daily. */
export function stations(): Promise<SnotelStation[]> {
	return cached('mountain:snotel-stations', 24 * HOUR, () =>
		getJson<SnotelStation[]>(
			`${AWDB}/stations?stationTriplets=*:WA:SNTL,*:OR:SNTL,*:CA:SNTL,*:NV:SNTL,*:ID:SNTL,*:UT:SNTL&activeOnly=true`
		)
	);
}

/**
 * Snow at the road over a pass: the SNOTEL gauge closest to the road's height (within 1,000 feet), or null if there
 * is none near or no reading. `roadFt` says how high the road is, so a page can say how far above it the gauge is.
 */
export async function snowAtPass(
	pass: PassInfo
): Promise<(SnowReading & { roadFt: number | null }) | null> {
	try {
		const station = roadStation(await stations(), pass);
		if (!station) return null;
		return await cached(`mountain:snow:${station.stationTriplet}`, 30 * 60 * 1000, async () => {
			// Station clocks are behind UTC, so a begin date two days back in UTC always covers the last 24 hours.
			const begin = new Date(Date.now() - 48 * HOUR).toISOString().slice(0, 13).replace('T', ' ');
			const body = await getJson<{ data?: AwdbSeries[] }[]>(
				`${AWDB}/data?stationTriplets=${encodeURIComponent(station.stationTriplet)}&elements=SNWD,WTEQ,TOBS&duration=HOURLY&beginDate=${encodeURIComponent(`${begin}:00`)}&endDate=2100-01-01`
			);
			return snowReading(station, body[0]?.data ?? []);
		}).then((r) => (r ? { ...r, roadFt: pass.elevation_ft ?? null } : null));
	} catch (err) {
		console.warn(`[mountain] snow at ${pass.id}: ${(err as Error).message}`);
		return null;
	}
}

/** Today's avalanche danger for the zone the pass is in, or null if it is in no zone or the service is down. */
export async function avalancheAtPass(pass: PassInfo): Promise<AvalancheDanger | null> {
	try {
		const zones = await cached('mountain:avalanche', 30 * 60 * 1000, async () => {
			const body = await getJson<{ features?: AvalancheZone[] }>(AVALANCHE);
			return body.features ?? [];
		});
		return avalancheAt(zones, pass);
	} catch (err) {
		console.warn(`[mountain] avalanche: ${(err as Error).message}`);
		return null;
	}
}
