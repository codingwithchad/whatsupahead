import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCache } from './cache';
import { crossingTimes } from './crossing';

afterEach(() => {
	vi.unstubAllGlobals();
	clearCache();
});

const NOW = Date.UTC(2026, 10, 26, 16); // 8 AM Pacific, Thanksgiving

describe('crossingTimes', () => {
	it('gives the summit forecast for each time you could leave, at the summit height', async () => {
		let asked: URL | null = null;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: URL) => {
				asked = url;
				const time = Array.from({ length: 72 }, (_, h) =>
					new Date(Date.UTC(2026, 10, 26) + h * 3600_000).toISOString().slice(0, 16)
				);
				// Snow from 11 AM to 1 PM Pacific (19:00-21:00 UTC), 30°F until noon then 36°F.
				const utcHour = (i: number) => i % 24;
				return new Response(
					JSON.stringify({
						hourly: {
							time,
							temperature_2m: time.map((_, i) => (i < 20 ? 30 : 36)),
							snowfall: time.map((_, i) =>
								utcHour(i) >= 19 && utcHour(i) <= 21 && i < 24 ? 0.5 : 0
							)
						}
					})
				);
			})
		);
		const c = await crossingTimes(
			{ id: 'snoqualmie', name: 'Snoqualmie Pass', lat: 47.41, lon: -121.41, elevation_ft: 3022 },
			110,
			NOW
		);
		expect(asked!.searchParams.get('elevation')).toBe('921.1');
		expect(c!.slots).toHaveLength(13);
		// Leave now: at the summit about 9:50 AM, before the snow, 30°F.
		expect(c!.slots[0]).toMatchObject({ leaveIn: 0, level: 'freezing', tempF: 30 });
		// Leave in 1 or 2 hours: you'd cross in the snow.
		expect(c!.slots[1].level).toBe('snow');
		expect(c!.slots[2].level).toBe('snow');
		// Leave in 4 hours: after it, above freezing.
		expect(c!.slots[4]).toMatchObject({ level: 'clear', tempF: 36 });
	});

	it('is left out when the forecast does not answer', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('down', { status: 503 }))
		);
		expect(await crossingTimes({ id: 'x', name: 'X', lat: 47, lon: -121 }, 60, NOW)).toBeNull();
	});
});
