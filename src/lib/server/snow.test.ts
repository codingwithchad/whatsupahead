import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCache } from './cache';
import { getCatalog } from './catalog';
import { samplePoints, snowAlong } from './snow';
import type { LatLon } from '../route';

/** Yakima to Bellevue the way the road goes: over Manastash Ridge on I-82, then Snoqualmie Pass on I-90. */
function yakimaToBellevue(): LatLon[] {
	const legs: LatLon[] = [
		[46.6, -120.51], // Yakima
		[46.8817, -120.4249], // Manastash Ridge summit
		[46.99, -120.55], // Ellensburg
		[47.2, -121.0], // Cle Elum
		[47.41, -121.4058], // Snoqualmie Pass summit
		[47.61, -122.2] // Bellevue
	];
	const out: LatLon[] = [];
	for (let i = 0; i < legs.length - 1; i++)
		for (let k = 0; k < 40; k++) {
			const t = k / 40;
			out.push([
				legs[i][0] + (legs[i + 1][0] - legs[i][0]) * t,
				legs[i][1] + (legs[i + 1][1] - legs[i][1]) * t
			]);
		}
	out.push(legs[legs.length - 1]);
	return out;
}

describe('samplePoints', () => {
	it('includes both ends and stays under the cap on a long route', () => {
		const route: [number, number][] = [];
		for (let i = 0; i <= 200; i++) route.push([47 + i * 0.01, -122]);
		const pts = samplePoints(route);
		expect(pts.length).toBeLessThanOrEqual(24);
		expect(pts[0].along).toBe(0);
		expect(pts[pts.length - 1].lat).toBeCloseTo(49, 1);
	});
});

describe('the summit of each pass', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		clearCache();
	});

	it('is always one of the points, at its known height', () => {
		const pts = samplePoints(yakimaToBellevue(), getCatalog().passes);
		const summit = pts.find((p) => p.feet === 3022);
		expect(summit?.lat).toBeCloseTo(47.41, 2);
		expect(pts.find((p) => p.feet === 2672)).toBeTruthy();
		expect(pts.map((p) => p.along)).toEqual([...pts.map((p) => p.along)].sort((a, b) => a - b));
	});

	it('Yakima to Bellevue: the highest point is Snoqualmie at 3,022 ft, forecast at that height', async () => {
		const asked: URL[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: URL) => {
				asked.push(url);
				const count = url.searchParams.get('latitude')!.split(',').length;
				const heights = url.searchParams.get('elevation')?.split(',').map(Number);
				const time = Array.from({ length: 72 }, (_, h) =>
					new Date(Date.UTC(2026, 10, 26) + h * 3_600_000).toISOString().slice(0, 16)
				);
				// Open-Meteo's own terrain height beside the road: lower than the summit.
				const place = (i: number) => ({
					elevation: heights?.[i] ?? 600,
					hourly: { time, temperature_2m: time.map(() => 30), snowfall: time.map(() => 0) }
				});
				return new Response(JSON.stringify(Array.from({ length: count }, (_, i) => place(i))));
			})
		);
		const report = await snowAlong(yakimaToBellevue(), Date.UTC(2026, 10, 26, 16), 150);
		expect(Math.max(...report!.samples.map((s) => s.feet))).toBe(3022);
		const withHeights = asked.find((u) => u.searchParams.has('elevation'))!;
		expect(withHeights.searchParams.get('elevation')).toContain('921.1');
	});
});
