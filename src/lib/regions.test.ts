import { describe, expect, it } from 'vitest';
import { regionAt, timeZoneAt } from './regions';

describe('regions', () => {
	it('finds the region a point is in', () => {
		expect(regionAt(47.61, -122.33)?.abbr).toBe('WA');
		expect(regionAt(45.33, -121.71)?.abbr).toBe('OR');
		expect(regionAt(43.6, -116.2)?.abbr).toBe('ID'); // Boise
		expect(regionAt(46.87, -113.99)).toBeUndefined(); // Missoula, Montana
	});

	it('follows the Snake River between Oregon and Idaho', () => {
		expect(regionAt(44.027, -116.963)?.abbr).toBe('OR'); // Ontario
		expect(regionAt(43.877, -116.995)?.abbr).toBe('OR'); // Nyssa
		expect(regionAt(44.078, -116.934)?.abbr).toBe('ID'); // Payette
		expect(regionAt(44.25, -116.97)?.abbr).toBe('ID'); // Weiser
		expect(regionAt(46.42, -117.0)?.abbr).toBe('ID'); // Lewiston
		expect(regionAt(46.42, -117.05)?.abbr).toBe('WA'); // Clarkston
		expect(regionAt(47.46, -115.694)?.abbr).toBe('ID'); // Lookout Pass, on the Montana line
		expect(regionAt(45.689, -113.948)?.abbr).toBe('ID'); // Lost Trail Pass
	});

	it('follows the Columbia River between Washington and Oregon', () => {
		expect(regionAt(45.669, -121.89)?.abbr).toBe('OR'); // Cascade Locks
		expect(regionAt(45.696, -121.885)?.abbr).toBe('WA'); // Stevenson
		expect(regionAt(45.705, -121.52)?.abbr).toBe('OR'); // Hood River
		expect(regionAt(45.73, -121.49)?.abbr).toBe('WA'); // White Salmon
		expect(regionAt(45.6, -121.18)?.abbr).toBe('OR'); // The Dalles
		expect(regionAt(46.188, -123.83)?.abbr).toBe('OR'); // Astoria
		expect(regionAt(45.631, -122.67)?.abbr).toBe('WA'); // Vancouver
		expect(regionAt(45.52, -122.68)?.abbr).toBe('OR'); // Portland
		expect(regionAt(46.14, -122.94)?.abbr).toBe('WA'); // Longview
	});

	it('follows the Nevada line and the Colorado River around California', () => {
		expect(regionAt(41.73, -122.63)?.abbr).toBe('CA'); // Yreka
		expect(regionAt(42.19, -122.71)?.abbr).toBe('OR'); // Ashland
		expect(regionAt(38.94, -119.98)?.abbr).toBe('CA'); // South Lake Tahoe
		expect(regionAt(38.96, -119.94)).toBeUndefined(); // Stateline, Nevada
		expect(regionAt(37.65, -118.97)?.abbr).toBe('CA'); // Mammoth Lakes
		expect(regionAt(36.17, -115.14)).toBeUndefined(); // Las Vegas
		expect(regionAt(34.84, -114.61)?.abbr).toBe('CA'); // Needles
		expect(regionAt(32.69, -114.63)).toBeUndefined(); // Yuma, Arizona
		expect(regionAt(32.72, -117.16)?.abbr).toBe('CA'); // San Diego
		expect(regionAt(32.53, -117.04)).toBeUndefined(); // Tijuana
		expect(regionAt(33.39, -118.42)?.abbr).toBe('CA'); // Avalon, Catalina
	});

	it('gives local time zones, including the part of Oregon on Mountain time', () => {
		expect(timeZoneAt(47.61, -122.33)).toBe('America/Los_Angeles');
		expect(timeZoneAt(45.33, -121.71)).toBe('America/Los_Angeles');
		expect(timeZoneAt(43.98, -117.0)).toBe('America/Boise');
	});

	it('gives Idaho Mountain time, and Pacific time north of the Salmon River', () => {
		expect(timeZoneAt(43.615, -116.2)).toBe('America/Boise'); // Boise
		expect(timeZoneAt(43.697, -114.351)).toBe('America/Boise'); // Sun Valley
		expect(timeZoneAt(44.911, -116.099)).toBe('America/Boise'); // McCall
		expect(timeZoneAt(47.677, -116.78)).toBe('America/Los_Angeles'); // Coeur d'Alene
		expect(timeZoneAt(47.538, -116.12)).toBe('America/Los_Angeles'); // Kellogg, Silver Mountain
		expect(timeZoneAt(48.368, -116.62)).toBe('America/Los_Angeles'); // Schweitzer
		expect(timeZoneAt(45.42, -116.315)).toBe('America/Los_Angeles'); // Riggins
		expect(timeZoneAt(45.689, -113.948)).toBe('America/Boise'); // Lost Trail Pass
	});

	it('the data scripts put files in the same region as the app', async () => {
		// The scripts' plain JavaScript copy of regionAt (loaded by path so the type checker leaves it alone).
		const script = '../../scripts/lib/data.mjs';
		const { regionAt: scriptRegionAt } = await import(/* @vite-ignore */ script);
		const points: [number, number][] = [
			[46.0, -123.92], // Seaside
			[45.8918, -123.9615], // Cannon Beach
			[45.669, -121.885], // Cascade Locks
			[45.705, -121.52], // Hood River
			[46.188, -123.83], // Astoria
			[45.631, -122.67], // Vancouver
			[45.73, -121.49], // White Salmon
			[47.61, -122.33], // Seattle
			[44.06, -121.31], // Bend
			[43.877, -116.995], // Nyssa
			[43.615, -116.2], // Boise
			[47.677, -116.78] // Coeur d'Alene
		];
		for (const [lat, lon] of points)
			expect(scriptRegionAt(lat, lon)?.abbr, `${lat},${lon}`).toBe(regionAt(lat, lon)?.abbr);
	});
});
