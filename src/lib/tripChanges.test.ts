import { describe, expect, it } from 'vitest';
import { tripChanges, type Snapshot } from './tripChanges';
import type { PassReport } from './passes';
import type { RoadWarnings } from './roadAhead';
import type { RouteWeather, StopWeather } from './routeWeather';
import { pacificTime, surfaceReading } from './roadSurface';

const report = (status: PassReport['status'], label: string): PassReport => ({
	id: 11,
	status,
	label,
	restrictions: [],
	road: '',
	weather: '',
	tempF: null,
	advisory: false,
	updated: null
});
const warnings = (over: Partial<RoadWarnings> = {}): RoadWarnings => ({
	closures: [],
	chainControls: [],
	alerts: [],
	surface: [],
	unchecked: [],
	...over
});
const stop = (over: Partial<StopWeather>): StopWeather => ({
	kind: 'pass',
	label: 'Snoqualmie Pass',
	lat: 47.4,
	lon: -121.4,
	along: 50,
	minutesIn: 60,
	phrase: 'Cloudy',
	tempF: 35,
	precip: null,
	windMph: 5,
	gustMph: 10,
	hazard: 0,
	hazards: [],
	...over
});
const wx = (s: StopWeather, source: RouteWeather['source'] = 'Open-Meteo'): RouteWeather => ({
	source,
	stops: [s]
});
const snap = (over: Partial<Snapshot>): Snapshot => ({
	passes: [],
	warnings: warnings(),
	onTheWay: null,
	...over
});
const surface = (surfaceF: number, along = 50) => ({
	name: 'Denny Creek on I-90 at mp 50.44',
	lat: 47.4,
	lon: -121.44,
	surfaceF,
	airF: 38,
	wet: true,
	at: 0,
	along
});

describe('tripChanges', () => {
	const pass = (r: PassReport, along = 50) => ({
		id: 'snoqualmie',
		name: 'Snoqualmie Pass',
		along,
		report: r
	});

	it('says when a pass gets worse, and when it gets better', () => {
		const open = snap({ passes: [pass(report('open', 'Open'))] });
		const chains = snap({ passes: [pass(report('chains', 'Chains required'))] });
		expect(tripChanges(open, chains, null)).toEqual([
			{ tone: 'danger', text: 'Snoqualmie Pass: now chains required (was open).' }
		]);
		expect(tripChanges(chains, open, null)[0].tone).toBe('good');
		expect(tripChanges(open, open, null)).toEqual([]);
	});

	it('ignores what is already behind you', () => {
		const open = snap({ passes: [pass(report('open', 'Open'), 20)] });
		const closed = snap({ passes: [pass(report('closed', 'Closed'), 20)] });
		expect(tripChanges(open, closed, 40)).toEqual([]);
		expect(tripChanges(open, closed, 10)).toHaveLength(1);
	});

	it('says when the road surface reaches freezing', () => {
		const before = snap({ warnings: warnings({ surface: [surface(36)] }) });
		const after = snap({ warnings: warnings({ surface: [surface(31)] }) });
		const [c] = tripChanges(before, after, null);
		expect(c.tone).toBe('danger');
		expect(c.text).toContain('31°F');
		// Already freezing last time: not said again.
		expect(tripChanges(after, after, null)).toEqual([]);
	});

	it('says when ice or snow is newly expected at a pass when you get there', () => {
		const sunny = snap({ onTheWay: wx(stop({})) });
		const icy = snap({ onTheWay: wx(stop({ hazard: 2, hazards: ['Ice possible'] })) });
		expect(tripChanges(sunny, icy, null)[0].text).toMatch(
			/^Ice possible now expected at Snoqualmie Pass/
		);
		// A different forecast service is not a change in the weather.
		const azure = snap({ onTheWay: wx(stop({}), 'Azure Maps') });
		expect(tripChanges(azure, icy, null)).toEqual([]);
	});

	it('says new closures and warnings, worst first', () => {
		const after = snap({
			passes: [],
			warnings: warnings({
				alerts: [
					{
						event: 'Winter Weather Advisory',
						tone: 'caution',
						fromMile: 40,
						toMile: 60,
						at: { lat: 47, lon: -121 },
						reach: 0,
						ends: null,
						near: 'Snoqualmie Pass'
					}
				],
				closures: [
					{
						source: 'WSDOT',
						headline: 'I-90 is closed at milepost 47',
						start: { lat: 47, lon: -121 },
						end: { lat: 47, lon: -121 },
						updated: null,
						link: '',
						along: 47
					}
				]
			})
		});
		const list = tripChanges(snap({}), after, null);
		expect(list.map((c) => c.tone)).toEqual(['danger', 'caution']);
	});
});

describe('road surface readings', () => {
	it('reads WSDOT local times as Pacific', () => {
		expect(new Date(pacificTime('2026-12-01T18:00:00')).toISOString()).toBe(
			'2026-12-02T02:00:00.000Z'
		);
		expect(new Date(pacificTime('2026-07-01T18:00:00')).toISOString()).toBe(
			'2026-07-02T01:00:00.000Z'
		);
	});
	it('takes the coldest sensor, in °F, and skips old readings', () => {
		const station = {
			StationId: 1,
			StationName: 'Denny Creek on I-90 at mp 50.44',
			Latitude: 47.4,
			Longitude: -121.44,
			ReadingTime: '2026-12-01T18:00:00',
			AirTemperature: 1,
			PrecipitationPast6Hours: 0.1,
			SurfaceMeasurements: [
				{ SurfaceTemperature: 0.5 },
				{ SurfaceTemperature: -1 },
				{ SurfaceTemperature: null }
			]
		};
		const now = pacificTime('2026-12-01T18:10:00');
		expect(surfaceReading(station, now)).toMatchObject({ surfaceF: 30, airF: 34, wet: true });
		expect(surfaceReading(station, now + 3 * 3600_000)).toBeNull();
		expect(surfaceReading({ ...station, SurfaceMeasurements: [] }, now)).toBeNull();
		expect(surfaceReading({ ...station, ReadingTime: null }, now)).toBeNull();
	});
});
