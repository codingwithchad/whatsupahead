import { distanceMiles, isDormant, nearby, parseLatLon, type Point } from '../geo';
import { duration } from '../format';
import { alongRoute, type LatLon } from '../route';
import type { Camera, FeaturedPlace, Place } from '../types';
import { geocode } from './geocode';

// The parts of a drive that both the trip page and its share picture need.

export const DEFAULT_DESTINATION_RADIUS = 3;
const NEAREST_FALLBACK_MILES = 15;

/** One of our places by id or name, a "lat,lon", or a search. */
export async function resolvePlace(
	q: string,
	places: FeaturedPlace[]
): Promise<(Place & { featured?: FeaturedPlace }) | null> {
	const text = q.trim();
	if (!text) return null;
	const lower = text.toLowerCase();
	const featured = places.find((p) => p.id === lower || p.name.toLowerCase() === lower);
	if (featured) return { lat: featured.lat, lon: featured.lon, label: featured.name, featured };
	const point = parseLatLon(text);
	if (point) return { ...point, label: 'Your location' };
	return geocode(text);
}

/** Stops along the way, in order: "lat,lon;lat,lon" (at most 8). */
export function parseVia(param: string | null): Point[] {
	return (param ?? '')
		.split(';')
		.map((p) => parseLatLon(p))
		.filter((p): p is NonNullable<typeof p> => p !== null)
		.slice(0, 8);
}

/**
 * Cameras on the drive in the order you pass them: road cameras along the road, other views (skyline, parks)
 * only near the destination, and always one near the destination, even when the nearest is a few miles off.
 */
export function camerasAlong(
	cameras: Camera[],
	route: LatLon[],
	to: Point,
	destRadius: number,
	total: number
): { item: Camera; along: number; off: number }[] {
	const isRoad = (c: Camera) => c.tags?.includes('road') ?? false;
	const found = [
		...alongRoute(cameras.filter(isRoad), route),
		...alongRoute(
			cameras.filter((c) => !isRoad(c)),
			route,
			{ corridor: 0, endBuffer: 0, destinationRadius: destRadius }
		)
	].sort((a, b) => a.along - b.along || a.off - b.off);
	if (!found.some((f) => distanceMiles(f.item, to) <= destRadius)) {
		const closest = nearby(
			cameras.filter((c) => !isDormant(c) && c.feed_url),
			to,
			NEAREST_FALLBACK_MILES
		)[0];
		// It may already be on the list (along the road, just outside the destination radius).
		if (closest && !found.some((f) => f.item.id === closest.id))
			found.push({ item: closest, along: total, off: closest.distance });
	}
	return found;
}

/** Mountain passes the drive goes over (within a couple of miles of the road), in the order you reach them. */
export function passesOnRoute<T extends Point>(passes: T[], route: LatLon[], total: number): T[] {
	return alongRoute(passes, route, { corridor: 2, destinationRadius: 0 })
		.filter((p) => p.along > 1 && p.along < total - 1)
		.map((p) => p.item);
}

/** "104 mi, about 2 h 5 min, over Stevens Pass." */
export function tripLine(miles: number, minutes: number, passNames: string[]): string {
	const over = passNames.length
		? `, over ${passNames.length > 2 ? `${passNames.slice(0, 2).join(', ')} and more` : passNames.join(' and ')}`
		: '';
	return `${Math.round(miles)} mi, about ${duration(minutes)}${over}.`;
}
