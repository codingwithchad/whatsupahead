import { describe, expect, it } from 'vitest';
import { avalancheAt, nearestStation, snowReading, type AwdbSeries } from './mountain';

const olallie = {
	stationTriplet: '672:WA:SNTL',
	name: 'Olallie Meadows',
	elevation: 4010,
	latitude: 47.37406,
	longitude: -121.44213,
	dataTimeZone: -8
};
const snoqualmie = { lat: 47.41, lon: -121.405833, elevation_ft: 3022 };

describe('nearestStation', () => {
	it('picks a station near the pass and close in height', () => {
		const far = { ...olallie, stationTriplet: 'x', name: 'Far', latitude: 48.5 };
		const high = { ...olallie, stationTriplet: 'y', name: 'High', elevation: 6500 };
		expect(nearestStation([far, high, olallie], snoqualmie)?.name).toBe('Olallie Meadows');
		expect(nearestStation([far, high], snoqualmie)).toBeNull();
	});
});

describe('snowReading', () => {
	const hours = (start: string, values: (number | null)[]) =>
		values.map((value, i) => {
			const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 3600_000);
			return { date: d.toISOString().slice(0, 16).replace('T', ' '), value };
		});
	const station = { ...olallie, miles: 3.7 };

	it('reads the latest depth, its 24-hour change and the temperature', () => {
		const depths = [...Array(24).fill(10), ...Array(5).fill(16)];
		const series: AwdbSeries[] = [
			{ stationElement: { elementCode: 'SNWD' }, values: hours('2026-12-01', [...depths, null]) },
			{ stationElement: { elementCode: 'TOBS' }, values: hours('2026-12-01', Array(30).fill(28)) }
		];
		const r = snowReading(station, series)!;
		expect(r.depthIn).toBe(16);
		expect(r.change24).toBe(6);
		expect(r.tempF).toBe(28);
		// 04:00 station time (UTC-8) on Dec 2 is 12:00 UTC.
		expect(new Date(r.at).toISOString()).toBe('2026-12-02T12:00:00.000Z');
		expect(r.link).toContain('sitenum=672');
	});

	it('has no change without a reading from a day earlier, and nothing without any depth', () => {
		const series: AwdbSeries[] = [
			{ stationElement: { elementCode: 'SNWD' }, values: hours('2026-12-01', [3, 4]) }
		];
		expect(snowReading(station, series)?.change24).toBeNull();
		expect(snowReading(station, [])).toBeNull();
	});
});

describe('avalancheAt', () => {
	const zone = (level: number) => ({
		geometry: {
			type: 'Polygon',
			coordinates: [
				[
					[-121.6, 47.3],
					[-121.2, 47.3],
					[-121.2, 47.6],
					[-121.6, 47.6],
					[-121.6, 47.3]
				]
			]
		},
		properties: {
			name: 'Snoqualmie Pass',
			center: 'Northwest Avalanche Center',
			center_id: 'NWAC',
			danger: '',
			danger_level: level,
			link: 'https://nwac.us/forecasts/avalanche/snoqualmie-pass'
		}
	});
	it('finds the zone and names the danger', () => {
		expect(avalancheAt([zone(3)], snoqualmie)).toMatchObject({ level: 3, danger: 'Considerable' });
		expect(avalancheAt([zone(-1)], snoqualmie)).toMatchObject({ level: null, danger: 'No rating' });
		expect(avalancheAt([zone(3)], { lat: 46, lon: -121 })).toBeNull();
	});
});
