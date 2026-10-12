import { describe, expect, it } from 'vitest';
import { camerasAlong } from './trip';
import type { Camera } from '../types';
import type { LatLon } from '../route';

const cam = (id: string, lat: number, lon: number) =>
	({ id, name: id, lat, lon, feed_url: 'x', tags: ['road'] }) as unknown as Camera;

describe('camerasAlong', () => {
	it('lists the nearest camera to the destination once, even when it is already on the road', () => {
		// The road runs east; the only camera is on it, 4 miles before the end (outside the 3-mile radius).
		const route: LatLon[] = Array.from({ length: 21 }, (_, i) => [47, -122 + i * 0.01]);
		const end = { lat: 47, lon: -121.8 };
		const found = camerasAlong([cam('a', 47, -121.885)], route, end, 3, 9.4);
		expect(found.map((f) => f.item.id)).toEqual(['a']);
	});
});
