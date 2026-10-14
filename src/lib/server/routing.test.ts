import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCache } from './cache';
import { driveMinutes, drivingRoute, toDrivingRoute } from './routing';
import { withVisitor } from './visitor';

const geometry = {
	coordinates: [[-122.3, 47.6] as [number, number], [-121.7, 47.9] as [number, number]]
};

describe('driveMinutes', () => {
	it('reads OSRM seconds as minutes divided by 60', () => {
		// 60 miles in 75 minutes
		const r = toDrivingRoute({ distance: 60 * 1609.344, duration: 75 * 60, geometry });
		expect(r.miles).toBeCloseTo(60, 5);
		expect(r.minutes).toBeCloseTo(75, 5);
	});

	it('keeps normal steps exactly as given', () => {
		const minutes = driveMinutes({
			duration: 3600,
			legs: [
				{
					steps: [
						{ distance: 40000, duration: 2400 },
						{ distance: 20000, duration: 1200 }
					]
				}
			]
		});
		expect(minutes).toBeCloseTo(60, 5);
	});

	it('does not let a mapped logging road at walking pace add hours', () => {
		// 9 miles rated at 176 minutes (3 mph), as OSRM did for Wallace Falls Mainline
		const minutes = driveMinutes({
			duration: (60 + 176) * 60,
			legs: [
				{
					steps: [
						{ distance: 51 * 1609.344, duration: 60 * 60 },
						{ distance: 9 * 1609.344, duration: 176 * 60 }
					]
				}
			]
		});
		expect(minutes).toBeLessThan(60 + 25);
		expect(minutes).toBeGreaterThan(60);
	});
});

describe('drivingRoute limits', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		clearCache();
	});

	const osrm = () =>
		vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						code: 'Ok',
						routes: [{ distance: 1609.344, duration: 60, geometry, legs: [] }]
					})
				)
		);
	const point = (i: number) => ({ lat: 47 + i / 100, lon: -122 });

	it('stops one visitor asking for a flood of new routes, but answers routes already worked out', async () => {
		const fetch = osrm();
		vi.stubGlobal('fetch', fetch);
		await withVisitor('203.0.113.50', async () => {
			for (let i = 0; i < 20; i++) await drivingRoute(point(i), point(i + 50));
			await expect(drivingRoute(point(30), point(80))).rejects.toThrow();
			// Already in the cache: no new work, so no limit.
			await expect(drivingRoute(point(0), point(50))).resolves.toBeTruthy();
		});
		expect(fetch).toHaveBeenCalledTimes(20);
		// Someone else still gets theirs.
		await withVisitor('203.0.113.51', () => drivingRoute(point(30), point(80)));
		expect(fetch).toHaveBeenCalledTimes(21);
	});

	it('gives the other ways over the mountains a smaller share than drive routes', async () => {
		vi.stubGlobal('fetch', osrm());
		// A fresh minute, past the routes the test above asked for.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 5 * 60_000);
		const results = await Promise.allSettled(
			Array.from({ length: 16 }, (_, i) =>
				withVisitor(`192.0.2.${i}`, () => drivingRoute(point(i), point(i + 60), [], { free: true }))
			)
		);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(15);
	});
});
