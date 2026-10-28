import { isDormant, nearby } from '../geo';
import { mountainStation, roadStation, snowReading, type SnotelStation } from '../mountain';
import { reportSource } from '../passes';
import { previewCredit } from '../sharing';
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
	// A place with no working cameras of its own (Crystal Mountain; Sunrise in winter) has nothing to show: its page
	// falls back to cameras miles away. `pictured`: its preview picture shows its cameras (their owners allow it).
	const working = cameras.filter((c) => c.feed_url && !isDormant(c));
	const near = (p: { lat: number; lon: number; radius_miles?: number }) =>
		nearby(working, p, p.radius_miles ?? 10);
	const hasCameras = (p: { lat: number; lon: number; radius_miles?: number }) => near(p).length > 0;
	const pictured = (p: { lat: number; lon: number; radius_miles?: number }) =>
		near(p).some((c) => previewCredit(c) !== null);
	const placeOf = new Map(places.map((p) => [p.id, p]));
	const [list, reports] = await Promise.all([
		stations(),
		allPassReports(passes).catch(() => new Map())
	]);
	type Spot = Omit<
		SnowingSpot,
		keyof ReturnType<typeof snowFacts> | 'gauge' | 'gaugeFeet' | 'gaugeMiles' | 'gaugeLink'
	> & {
		lat: number;
		lon: number;
		station: (SnotelStation & { miles: number }) | null;
		said: { text: string; by: string } | null;
	};
	const state = (p: { lat: number; lon: number }) => regionAt(p.lat, p.lon)?.abbr ?? null;
	const spots: Spot[] = [
		...passes
			.filter((p) => hasCameras(placeOf.get(p.place) ?? p))
			.map((p) => {
				const r = reports.get(p.id);
				return {
					id: p.id,
					name: p.name,
					kind: 'pass' as const,
					state: state(p),
					href: `/passes/${encodeURIComponent(p.id)}`,
					preview: `/og/search?place=${encodeURIComponent(p.place)}`,
					pictured: pictured(placeOf.get(p.place) ?? p),
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
				preview: `/og/search?place=${encodeURIComponent(p.id)}`,
				pictured: pictured(p),
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
				gaugeMiles: station ? Math.round(station.miles * 10) / 10 : null,
				gaugeLink: reading?.link ?? null,
				...snowFacts(reading, said, timeZoneAt(lat, lon), now)
			};
		})
		.filter(hasNewSnow)
		.sort(bySnow);
}
