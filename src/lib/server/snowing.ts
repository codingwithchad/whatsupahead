import { isDormant, nearby } from '../geo';
import { mountainStation, roadStation, snowReading, type SnotelStation } from '../mountain';
import { reportSource } from '../passes';
import { regionAt, timeZoneAt } from '../regions';
import { bySnow, hasNewSnow, snowFacts, type SnowingSpot } from '../snowing';
import { getCatalog } from './catalog';
import { stations } from './mountain';
import { allPassReports } from './passes';
import { gaugeReadings } from './skiSnow';

const KINDS: Record<string, SnowingSpot['kind']> = {
	'ski-areas': 'ski',
	'national-parks': 'park',
	scenic: 'park'
};

/**
 * Passes, ski areas and parks with new snow, snowing now first. Only USDA gauges (one request for all of them) and
 * the pass reports the passes page already keeps, so it costs no forecast calls. Drivers' numbers come from the
 * gauge at the road's height, skiers' from the highest gauge near (the two snow heights rule).
 */
export async function snowingNow(now = Date.now()): Promise<SnowingSpot[]> {
	const { passes, places, cameras } = getCatalog();
	// A place whose cameras are all down for the winter (Sunrise at Mount Rainier) has nothing to show.
	const working = cameras.filter((c) => c.feed_url && !isDormant(c));
	const hasCameras = (p: { lat: number; lon: number; radius_miles?: number }) =>
		nearby(working, p, p.radius_miles ?? 10).length > 0;
	const [list, reports] = await Promise.all([
		stations(),
		allPassReports(passes).catch(() => new Map())
	]);
	type Spot = Omit<
		SnowingSpot,
		keyof ReturnType<typeof snowFacts> | 'gauge' | 'gaugeFeet' | 'gaugeLink'
	> & {
		lat: number;
		lon: number;
		station: (SnotelStation & { miles: number }) | null;
		said: { text: string; by: string } | null;
	};
	const state = (p: { lat: number; lon: number }) => regionAt(p.lat, p.lon)?.abbr ?? null;
	const spots: Spot[] = [
		...passes.map((p) => {
			const r = reports.get(p.id);
			return {
				id: p.id,
				name: p.name,
				kind: 'pass' as const,
				state: state(p),
				href: `/passes/${encodeURIComponent(p.id)}`,
				lat: p.lat,
				lon: p.lon,
				station: roadStation(list, p),
				said:
					r && r.status !== 'off-season' && r.weather
						? { text: r.weather, by: reportSource(p) }
						: null
			};
		}),
		...places
			.filter((p) => p.collection && KINDS[p.collection] && hasCameras(p))
			.map((p) => ({
				id: p.id,
				name: p.name,
				kind: KINDS[p.collection!],
				state: state(p),
				href: `/search?place=${encodeURIComponent(p.id)}`,
				lat: p.lat,
				lon: p.lon,
				station: mountainStation(list, p),
				said: null
			}))
	];
	const triplets = [
		...new Set(spots.flatMap((s) => (s.station ? [s.station.stationTriplet] : [])))
	];
	const readings = await gaugeReadings(triplets);
	return spots
		.map(({ lat, lon, station, said, ...s }) => {
			const reading = station
				? snowReading(station, readings.get(station.stationTriplet) ?? [])
				: null;
			return {
				...s,
				gauge: station?.name ?? null,
				gaugeFeet: station?.elevation ?? null,
				gaugeLink: reading?.link ?? null,
				...snowFacts(reading, said, timeZoneAt(lat, lon), now)
			};
		})
		.filter(hasNewSnow)
		.sort(bySnow);
}
