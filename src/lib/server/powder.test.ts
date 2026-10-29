import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCache } from './cache';
import { powderDay, powderScore } from './powder';
import type { SkiSnow } from './skiSnow';

const snow = (over: Partial<SkiSnow>): SkiSnow => ({
	station: 'Gauge',
	stationFeet: 5000,
	miles: 1,
	link: null,
	depthIn: 40,
	change24: 0,
	sinceSix: 0,
	water24: 0,
	at: 0,
	forecastIn: 0,
	timeZone: 'America/Los_Angeles',
	...over
});

afterEach(() => {
	vi.unstubAllGlobals();
	clearCache();
});

describe('powderScore', () => {
	it('ranks the last 24 hours first, then since 6 AM, then the forecast, and ignores gauge wobble', () => {
		expect(powderScore(snow({ change24: 8 }))).toBeGreaterThan(
			powderScore(snow({ change24: 3, forecastIn: 10 }))
		);
		expect(powderScore(snow({ sinceSix: 3 }))).toBeGreaterThan(
			powderScore(snow({ forecastIn: 6 }))
		);
		expect(powderScore(snow({ change24: 1 }))).toBe(powderScore(snow({})));
		expect(powderScore(null)).toBe(-1);
	});
});

describe('powderDay', () => {
	it('asks for every drive in one request, by road, and keeps only those within the time', async () => {
		const asked: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string | URL) => {
				const u = String(url);
				asked.push(u);
				if (u.includes('/table/')) {
					const n = u.split('/table/v1/driving/')[1].split('?')[0].split(';').length - 1;
					// Every other ski area is a long drive round the mountains, whatever the straight line.
					return new Response(
						JSON.stringify({
							code: 'Ok',
							durations: [[0, ...Array.from({ length: n }, (_, i) => (i % 2 ? 5 * 3600 : 90 * 60))]]
						})
					);
				}
				return new Response('down', { status: 503 });
			})
		);
		const spots = await powderDay({ lat: 47.61, lon: -122.33 }, 3);
		expect(asked.filter((u) => u.includes('/table/'))).toHaveLength(1);
		expect(spots.length).toBeGreaterThan(0);
		expect(spots.every((s) => s.minutes === 90)).toBe(true);
		// The pass places with a ski area at the top count too.
		expect(asked[0]).toContain('-121.4');
	});
});
