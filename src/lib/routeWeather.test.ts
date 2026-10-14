import { describe, expect, it } from 'vitest';
import type { LatLon } from './route';
import { fromAzure, fromOpenMeteo, headline, routeStops, type RouteStop } from './routeWeather';

// A straight road east from (47, -122) to (47, -120): about 94 miles, timed at 120 minutes.
const road: LatLon[] = Array.from({ length: 101 }, (_, i) => [47, -122 + i * 0.02]);
const ends = {
	from: { lat: 47, lon: -122, label: 'Seattle' },
	to: { lat: 47, lon: -120, label: 'Leavenworth' }
};
const passes = [
	{ name: 'Blewett Pass', lat: 47.001, lon: -120.6, elevation_ft: 4102, place: 'pass-blewett' },
	{
		name: 'Snoqualmie Pass',
		lat: 47.002,
		lon: -121.4,
		elevation_ft: 3022,
		place: 'snoqualmie-pass'
	},
	{ name: 'Far Pass', lat: 47.5, lon: -121 }
];

describe('routeStops', () => {
	it('puts the passes on the road in driving order, each timed for when you get there', () => {
		const stops = routeStops(road, 120, 0, ends, passes);
		expect(stops.map((s) => s.label)).toEqual([
			'Seattle',
			'Snoqualmie Pass',
			'Blewett Pass',
			'Leavenworth'
		]);
		expect(stops[0].minutesIn).toBe(0);
		expect(stops[1].minutesIn).toBeCloseTo(36, 0); // 30% of the way
		expect(stops[2].minutesIn).toBeCloseTo(84, 0); // 70% of the way
		expect(stops[3].minutesIn).toBeCloseTo(120, 0);
		expect(stops[1].place).toBe('snoqualmie-pass');
	});

	it('adds the time until you leave to every stop', () => {
		const stops = routeStops(road, 120, 60, ends, passes);
		expect(stops[0].minutesIn).toBe(60);
		expect(stops.at(-1)!.minutesIn).toBeCloseTo(180, 0);
	});

	it('fills a long stretch with no pass with a point about every hour, named after a nearby town', () => {
		const stops = routeStops(road, 300, 0, ends, [], () => 'Ellensburg');
		const way = stops.filter((s) => s.kind === 'way');
		expect(way.length).toBe(4);
		expect(way[0].label).toBe('Near Ellensburg');
		for (let i = 1; i < stops.length; i++)
			expect(stops[i].minutesIn - stops[i - 1].minutesIn).toBeLessThanOrEqual(75);
	});
});

const stop: RouteStop = {
	kind: 'pass',
	label: 'Snoqualmie Pass',
	lat: 47.4,
	lon: -121.4,
	along: 50,
	minutesIn: 60
};

describe('weather sources', () => {
	it('converts Azure Maps (metric) and only counts falling snow as snow', () => {
		const w = fromAzure(stop, {
			shortPhrase: 'Light snow',
			temperature: { value: -1, unit: 'C' },
			windGust: { speed: { value: 48, unit: 'km/h' } },
			precipitation: { dbz: 25, type: 'SNOW' },
			hazards: {
				maxHazardIndex: 2,
				hazardDetails: [
					{ hazardIndex: 1, shortPhrase: 'Gusty winds' },
					{ hazardIndex: 2, shortPhrase: 'Snow' }
				]
			}
		});
		expect(w.tempF).toBe(30);
		expect(w.gustMph).toBe(30);
		expect(w.precip).toBe('snow');
		expect(w.hazards).toEqual(['Snow', 'Gusty winds']);
		expect(fromAzure(stop, { precipitation: { dbz: 0, type: 'SNOW' } }).precip).toBeNull();
	});

	it('takes the Open-Meteo hour you arrive in', () => {
		const now = Date.parse('2026-12-10T15:20:00Z');
		const hourly = {
			time: ['2026-12-10T15:00', '2026-12-10T16:00', '2026-12-10T17:00'],
			temperature_2m: [36, 31, 29],
			weather_code: [3, 73, 75],
			wind_speed_10m: [5, 10, 15],
			wind_gusts_10m: [10, 25, 35],
			snowfall: [0, 0.5, 1.2],
			precipitation: [0, 0.05, 0.12]
		};
		const w = fromOpenMeteo(stop, hourly, now)!; // 16:20, in the 16:00 hour
		expect(w.tempF).toBe(31);
		expect(w.phrase).toBe('Snow');
		expect(w.hazard).toBe(2);
		expect(fromOpenMeteo({ ...stop, minutesIn: 600 }, hourly, now)).toBeNull();
	});

	it('sums the drive up with the worst point', () => {
		const calm = fromAzure({ ...stop, label: 'Seattle' }, { shortPhrase: 'Clear' });
		const snowy = fromAzure(stop, {
			shortPhrase: 'Snow',
			precipitation: { dbz: 30, type: 'SNOW' },
			hazards: { maxHazardIndex: 3, hazardDetails: [{ hazardIndex: 3, shortPhrase: 'Heavy snow' }] }
		});
		expect(headline([calm, snowy])).toBe(
			'Heavy snow expected at Snoqualmie Pass when you get there.'
		);
		expect(headline([calm])).toBe('No weather trouble expected on the way.');
	});
});

describe('one leave time for the whole drive', () => {
	it('puts every stop at the leave time plus the drive to it, for leaving now and in an hour', () => {
		const road: [number, number][] = Array.from({ length: 101 }, (_, i) => [
			46.6 + i * 0.01,
			-120.5
		]);
		const ends = {
			from: { lat: 46.6, lon: -120.5, label: 'Yakima' },
			to: { lat: 47.6, lon: -120.5, label: 'Bellevue' }
		};
		const pass = [{ lat: 47.1, lon: -120.5, name: 'Middle Pass', elevation_ft: 3000 }];
		for (const leaveIn of [0, 60]) {
			const stops = routeStops(road, 120, leaveIn, ends, pass);
			expect(stops[0].minutesIn).toBe(leaveIn);
			expect(stops.find((s) => s.kind === 'pass')!.minutesIn).toBeCloseTo(leaveIn + 60, 0);
			expect(stops[stops.length - 1].minutesIn).toBeCloseTo(leaveIn + 120, 5);
		}
	});
});
