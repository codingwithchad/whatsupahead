import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayAt } from '../mountain';
import { clearCache } from './cache';
import { skiSnow } from './skiSnow';

// 10 AM Pacific on a winter day.
const NOW = Date.UTC(2027, 0, 15, 18);
const STATIONS = [
	{
		stationTriplet: '652:NV:SNTL',
		name: 'Mt Rose Ski Area',
		elevation: 8801,
		latitude: 39.316,
		longitude: -119.894,
		dataTimeZone: -8
	},
	{
		stationTriplet: '791:WA:SNTL',
		name: 'Stevens Pass',
		elevation: 3950,
		latitude: 47.74,
		longitude: -121.09,
		dataTimeZone: -8
	}
];
/** Hourly depth at the gauge: 40 in a day ago, 48 at 6 AM, 52 now. */
function series() {
	const values = [];
	for (let h = 30; h >= 0; h--) {
		const t = NOW - h * 3600_000;
		const local = new Date(t - 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
		values.push({ date: local, value: h >= 24 ? 40 : h >= 4 ? 48 : 52 });
	}
	return [{ stationElement: { elementCode: 'SNWD' }, values }];
}

afterEach(() => {
	vi.unstubAllGlobals();
	clearCache();
});

describe('todayAt', () => {
	it('finds 6 AM where the place is', () => {
		expect(new Date(todayAt(6, 'America/Los_Angeles', NOW)).toISOString()).toBe(
			'2027-01-15T14:00:00.000Z'
		);
		expect(new Date(todayAt(6, 'America/Boise', NOW)).toISOString()).toBe(
			'2027-01-15T13:00:00.000Z'
		);
	});
});

describe('skiSnow', () => {
	it('asks USDA once for every gauge, and sums the forecast to midnight', async () => {
		const asked: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string | URL) => {
				const u = String(url);
				asked.push(u);
				if (u.includes('/stations')) return new Response(JSON.stringify(STATIONS));
				if (u.includes('/data'))
					return new Response(
						JSON.stringify(
							STATIONS.map((s) => ({ stationTriplet: s.stationTriplet, data: series() }))
						)
					);
				// Open-Meteo: 1 in an hour all of today and tomorrow, for each place asked.
				const count = new URL(u).searchParams.get('latitude')!.split(',').length;
				const time = Array.from({ length: 48 }, (_, h) =>
					new Date(Date.UTC(2027, 0, 15) + h * 3600_000).toISOString().slice(0, 16)
				);
				return new Response(
					JSON.stringify(
						Array.from({ length: count }, () => ({ hourly: { time, snowfall: time.map(() => 1) } }))
					)
				);
			})
		);
		const snow = await skiSnow(
			[
				{ id: 'ski-mt-rose', lat: 39.3285, lon: -119.885 },
				{ id: 'stevens', lat: 47.745, lon: -121.089 }
			],
			NOW
		);
		expect(asked.filter((u) => u.includes('/data'))).toHaveLength(1);
		expect(snow['ski-mt-rose']).toMatchObject({
			station: 'Mt Rose Ski Area',
			depthIn: 52,
			change24: 12,
			sinceSix: 4,
			// 10 AM to midnight Pacific: 14 hours of 1 in.
			forecastIn: 14
		});
	});

	it('leaves numbers out rather than guess when there is no gauge near', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string | URL) =>
				String(url).includes('/stations')
					? new Response(JSON.stringify(STATIONS))
					: new Response('down', { status: 503 })
			)
		);
		const snow = await skiSnow([{ id: 'far', lat: 44, lon: -117 }], NOW);
		expect(snow.far).toMatchObject({ station: null, depthIn: null, forecastIn: null });
	});
});
