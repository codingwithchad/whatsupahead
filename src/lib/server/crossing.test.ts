import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCache } from './cache';
import { crossingTimes, leaveAdvice, leaveTimes } from './crossing';

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
		expect(c!.slots).toHaveLength(25);
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

describe('leaveAdvice', () => {
	const H = 3_600_000;
	// 10 PM Pacific the night before Thanksgiving (06:00 UTC).
	const NIGHT = Date.UTC(2026, 10, 26, 6);
	/** Hourly forecast from midnight UTC: snow in the hours ending at the given UTC hours. */
	const forecast = (snowHours: number[], temp = 30) => {
		const times = Array.from({ length: 72 }, (_, h) => Date.UTC(2026, 10, 26) + h * H);
		return {
			times,
			snowfall: times.map((_, h) => (snowHours.includes(h) ? 0.4 : 0)),
			temperature: times.map(() => temp)
		};
	};

	it('looked up at 10 PM, 90 minutes from the pass, storm at 7 AM: leave before 5:30 AM', () => {
		// Snow at the summit from 7 AM to 1 PM Pacific (15:00 to 21:00 UTC: hours ending 16 to 21).
		const a = leaveAdvice(forecast([16, 17, 18, 19, 20, 21]), 90, NIGHT);
		expect(new Date(a.snowFrom!).toISOString()).toBe('2026-11-26T15:00:00.000Z');
		expect(new Date(a.leaveBefore!).toISOString()).toBe('2026-11-26T13:30:00.000Z'); // 5:30 AM
		expect(new Date(a.leaveAfter!).toISOString()).toBe('2026-11-26T19:30:00.000Z'); // 11:30 AM
	});

	it('one dry hour in the middle of a storm does not end it', () => {
		const a = leaveAdvice(forecast([16, 17, 19, 20]), 90, NIGHT);
		expect(new Date(a.snowUntil!).toISOString()).toBe('2026-11-26T20:00:00.000Z');
	});

	it('already snowing when you could get there: no beating it, only waiting', () => {
		const a = leaveAdvice(forecast([7, 8, 9, 10, 11]), 60, NIGHT);
		expect(a.leaveBefore).toBeNull();
		expect(a.leaveAfter).not.toBeNull();
	});

	it('snowing past the next day: no time after it either', () => {
		const a = leaveAdvice(forecast(Array.from({ length: 50 }, (_, i) => 20 + i)), 60, NIGHT);
		expect(a.leaveAfter).toBeNull();
	});

	it('no snow: nothing to dodge, but says when it is freezing', () => {
		expect(leaveAdvice(forecast([]), 60, NIGHT)).toMatchObject({ snowFrom: null, freezing: true });
		expect(leaveAdvice(forecast([], 40), 60, NIGHT).freezing).toBe(false);
	});
});

describe('leaveTimes', () => {
	it('leave now, then on the hour for the next day', () => {
		const t = leaveTimes(Date.UTC(2026, 10, 26, 6, 12));
		expect(t[0]).toBe(0);
		expect(t[1]).toBe(48);
		expect(t).toHaveLength(25);
		expect(t.at(-1)).toBe(48 + 23 * 60);
	});
});
