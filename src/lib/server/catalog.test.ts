import { describe, expect, it } from 'vitest';
import { readFolder, withTown } from './catalog';
import type { Camera, WeatherSource } from '../types';

describe('data files', () => {
	const all = [
		...readFolder<Camera & { approved_by?: string }>('cameras'),
		...readFolder<WeatherSource & { approved_by?: string }>('weather-sources')
	];

	it('has data', () => {
		expect(all.length).toBeGreaterThan(0);
	});

	it('approved items name an approver', () => {
		for (const item of all.filter((i) => i.status === 'approved')) {
			expect(item.approved_by, item.id).toBeTruthy();
		}
	});

	it('live cameras have a feed url', () => {
		for (const cam of readFolder<Camera>('cameras')) {
			if (cam.availability !== 'seasonal' && !cam.provider)
				expect(cam.feed_url, cam.id).toBeTruthy();
			if (cam.provider) expect(cam.provider_ref, cam.id).toBeTruthy();
		}
	});
});

describe('places', () => {
	it('have valid coordinates', () => {
		const places = readFolder<{ id: string; lat: number; lon: number }>('places');
		expect(places.length).toBeGreaterThan(0);
		for (const p of places) {
			expect(Math.abs(p.lat), p.id).toBeLessThanOrEqual(90);
			expect(Math.abs(p.lon), p.id).toBeLessThanOrEqual(180);
		}
	});
});

describe('withTown', () => {
	it('names the nearest town for a camera named only by road and milepost', () => {
		const cam = (name: string) => ({ id: 'x', name, lat: 45.6721, lon: -118.7886 }) as Camera;
		expect(withTown(cam('I-84 at MP 210')).name).toMatch(/^I-84 at MP 210 \(near .+\)$/);
		expect(withTown(cam('I-84 at MP 210: Pendleton Exit')).name).toBe(
			'I-84 at MP 210: Pendleton Exit'
		);
	});
});
