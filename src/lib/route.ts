import { distanceMiles, type Point } from './geo';

export type LatLon = [lat: number, lon: number];

const MILES_PER_DEG_LAT = 69.05;

/** Miles from the start of the route to each vertex. */
export function cumulativeMiles(route: LatLon[]): number[] {
	const cum = [0];
	for (let i = 1; i < route.length; i++) {
		cum.push(
			cum[i - 1] +
				distanceMiles(
					{ lat: route[i - 1][0], lon: route[i - 1][1] },
					{ lat: route[i][0], lon: route[i][1] }
				)
		);
	}
	return cum;
}

export interface Projection {
	/** Miles from the start of the route to the closest point on it. */
	along: number;
	/** Miles from the route to the point. */
	off: number;
}

/** Closest point on the route to `p` (flat-earth maths per segment, fine at road scale). */
export function projectOnRoute(
	p: Point,
	route: LatLon[],
	cum: number[],
	segments?: Iterable<number>
): Projection {
	let best: Projection = { along: 0, off: Infinity };
	const cosLat = Math.cos((p.lat * Math.PI) / 180);
	for (const i of segments ?? route.keys()) {
		if (i >= route.length - 1) continue;
		const [aLat, aLon] = route[i];
		const [bLat, bLon] = route[i + 1];
		const bx = (bLon - aLon) * cosLat * MILES_PER_DEG_LAT;
		const by = (bLat - aLat) * MILES_PER_DEG_LAT;
		const px = (p.lon - aLon) * cosLat * MILES_PER_DEG_LAT;
		const py = (p.lat - aLat) * MILES_PER_DEG_LAT;
		const len2 = bx * bx + by * by;
		const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (px * bx + py * by) / len2));
		const off = Math.hypot(px - t * bx, py - t * by);
		if (off < best.off) best = { along: cum[i] + t * (cum[i + 1] - cum[i]), off };
	}
	return best;
}

const CELL = 0.05; // degrees, about 3.5 miles north-south

/**
 * A grid over the route, so a point is only compared with the stretches of road near it rather than all of
 * them (a long drive has thousands; the catalog has thousands of cameras). Returns, for a point and a distance
 * in miles, every segment whose box comes within that distance: a superset of the segments that can be that
 * close, so the nearest one found among them is the true nearest whenever it is within the distance.
 */
export function segmentGrid(route: LatLon[]): (p: Point, miles: number) => Set<number> {
	const cells = new Map<string, number[]>();
	for (let i = 0; i < route.length - 1; i++) {
		const [aLat, aLon] = route[i];
		const [bLat, bLon] = route[i + 1];
		for (
			let y = Math.floor(Math.min(aLat, bLat) / CELL);
			y <= Math.floor(Math.max(aLat, bLat) / CELL);
			y++
		)
			for (
				let x = Math.floor(Math.min(aLon, bLon) / CELL);
				x <= Math.floor(Math.max(aLon, bLon) / CELL);
				x++
			) {
				const key = `${y}:${x}`;
				const list = cells.get(key);
				if (list) list.push(i);
				else cells.set(key, [i]);
			}
	}
	return (p, miles) => {
		const dLat = miles / MILES_PER_DEG_LAT;
		const dLon = miles / (MILES_PER_DEG_LAT * Math.max(0.1, Math.cos((p.lat * Math.PI) / 180)));
		const out = new Set<number>();
		for (let y = Math.floor((p.lat - dLat) / CELL); y <= Math.floor((p.lat + dLat) / CELL); y++)
			for (let x = Math.floor((p.lon - dLon) / CELL); x <= Math.floor((p.lon + dLon) / CELL); x++)
				for (const i of cells.get(`${y}:${x}`) ?? []) out.add(i);
		return out;
	};
}

export interface AlongRoute<T> {
	item: T;
	along: number;
	off: number;
}

/**
 * Items on the way, in driving order. An item counts if it is within `corridor` miles of the road
 * and no more than `endBuffer` miles past the destination, or if it sits right at the destination
 * (like a resort camera a little off the road). Anything beyond that is dropped.
 */
export function alongRoute<T extends Point>(
	items: T[],
	route: LatLon[],
	opts: { corridor?: number; endBuffer?: number; destinationRadius?: number } = {}
): AlongRoute<T>[] {
	const { corridor = 1.5, endBuffer = 2, destinationRadius = 2.5 } = opts;
	if (route.length < 2) return [];
	const cum = cumulativeMiles(route);
	const total = cum[cum.length - 1];
	const end = { lat: route[route.length - 1][0], lon: route[route.length - 1][1] };
	const near = segmentGrid(route);
	const out: AlongRoute<T>[] = [];
	for (const item of items) {
		const atDestination = distanceMiles(item, end) <= destinationRadius;
		// Only the stretches of road near the item can be within the corridor. Items at the destination need
		// the whole road, to know how far along they are.
		const candidates = near(item, corridor);
		if (!candidates.size && !atDestination) continue;
		const { along, off } = projectOnRoute(item, route, cum, atDestination ? undefined : candidates);
		const onTheWay = off <= corridor && along <= total + endBuffer;
		if (onTheWay || atDestination)
			out.push({ item, along: onTheWay ? along : Math.max(along, total - 0.01), off });
	}
	return out.sort((a, b) => a.along - b.along || a.off - b.off);
}

/**
 * Thin a long list of stops so the drive shows spaced-out key cameras instead of every one.
 * Stops marked `keep` (other sources, the destination area) are always included.
 */
export function thinStops<T extends { along: number; keep?: boolean }>(
	stops: T[],
	minGap: number
): T[] {
	const out: T[] = [];
	let last = -Infinity;
	for (const s of stops) {
		if (s.keep || s.along - last >= minGap) {
			out.push(s);
			last = s.along;
		}
	}
	return out;
}

/** The smallest spacing (in 0.5 mile steps) that brings the list down to `target` stops or fewer. */
export function thinToTarget<T extends { along: number; keep?: boolean }>(
	stops: T[],
	target: number
): T[] {
	if (stops.length <= target) return stops;
	for (let gap = 0.5; gap <= 20; gap += 0.5) {
		const thinned = thinStops(stops, gap);
		if (thinned.length <= target) return thinned;
	}
	return thinStops(stops, 20);
}

/** The point `miles` along the route (clamped to its ends). */
export function pointAt(route: LatLon[], cum: number[], miles: number): Point {
	const total = cum[cum.length - 1];
	const m = Math.min(Math.max(miles, 0), total);
	let i = 1;
	while (i < cum.length - 1 && cum[i] < m) i++;
	const span = cum[i] - cum[i - 1];
	const t = span > 0 ? (m - cum[i - 1]) / span : 0;
	return {
		lat: route[i - 1][0] + t * (route[i][0] - route[i - 1][0]),
		lon: route[i - 1][1] + t * (route[i][1] - route[i - 1][1])
	};
}

/** Which way the road heads at `miles` along, in degrees from north (0 north, 90 east), over about a mile. */
export function headingAt(route: LatLon[], cum: number[], miles: number): number | null {
	if (route.length < 2) return null;
	const a = pointAt(route, cum, miles - 0.5);
	const b = pointAt(route, cum, miles + 0.5);
	const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
	const dx = (b.lon - a.lon) * k;
	const dy = b.lat - a.lat;
	if (!dx && !dy) return null;
	return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}
