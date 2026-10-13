import type { Point } from './geo';
import { decodePolyline } from './idaho';
import { cumulativeMiles, pointAt, projectOnRoute, type LatLon } from './route';

// A pass page lists its cameras in the order you'd pass them, one way or the other, instead of nearest first
// (nearest first jumps from one side of the summit to the other). Each pass with enough cameras has its
// highway's line saved (`road`, from scripts/build-pass-roads.mjs); a camera's place is where it meets that line.

export interface RoadOrder {
	/** The two ways over the pass as the signs say them, e.g. ["Eastbound", "Westbound"]. */
	ways: [string, string];
	/** Road miles from the summit to each camera; going the first way, they count up. */
	at: Record<string, number>;
	/** The compass word for each side of the summit, behind and ahead going the first way: ["west", "east"]. */
	sides: [string, string];
}

/**
 * Which way the highway's signs run: interstates and US highways with an even number run east and west, odd
 * north and south. State highways have no rule, so the line over the summit decides.
 */
function signedEastWest(route: string, dx: number, dy: number): boolean {
	const m = route.match(/^(I|US)\W*(\d+)/i);
	return m ? Number(m[2]) % 2 === 0 : Math.abs(dx) >= Math.abs(dy);
}

/** Each camera's place along the pass's highway, or null when the pass has no saved line. */
export function alongRoad(
	cameras: (Point & { id: string })[],
	pass: Point & { route: string; road?: string }
): RoadOrder | null {
	if (!pass.road || cameras.length < 3) return null;
	const line: LatLon[] = decodePolyline(pass.road).map((p) => [p.lat, p.lon]);
	const cum = cumulativeMiles(line);
	const summit = projectOnRoute(pass, line, cum).along;
	// Which way the line runs over the summit, ten miles each side.
	const a = pointAt(line, cum, summit - 10);
	const b = pointAt(line, cum, summit + 10);
	const dx = (b.lon - a.lon) * Math.cos((pass.lat * Math.PI) / 180);
	const dy = b.lat - a.lat;
	const eastWest = signedEastWest(pass.route, dx, dy);
	// Count up going east (or north), so the first way is always Eastbound or Northbound.
	const sign = (eastWest ? dx : dy) < 0 ? -1 : 1;
	const at: Record<string, number> = {};
	for (const c of cameras) at[c.id] = sign * (projectOnRoute(c, line, cum).along - summit);
	return eastWest
		? { ways: ['Eastbound', 'Westbound'], sides: ['west', 'east'], at }
		: { ways: ['Northbound', 'Southbound'], sides: ['south', 'north'], at };
}

/** The cameras in the order you'd pass them going way 0 or 1, each with where it is from the summit. */
export function inRoadOrder<C extends { id: string }>(
	cameras: C[],
	order: RoadOrder,
	way: 0 | 1
): { camera: C; note: string }[] {
	const sign = way === 0 ? 1 : -1;
	return [...cameras]
		.sort((a, b) => sign * ((order.at[a.id] ?? 0) - (order.at[b.id] ?? 0)))
		.map((camera) => {
			const at = order.at[camera.id] ?? 0;
			return {
				camera,
				note:
					Math.abs(at) < 0.5
						? 'At the summit'
						: `${Math.abs(at).toFixed(1)} mi ${order.sides[at < 0 ? 0 : 1]} of the summit`
			};
		});
}

const COMPASS: Record<string, string> = { e: 'east', w: 'west', n: 'north', s: 'south' };

/**
 * Which way a camera looks, when its name says so: "EB 80 at Kingvale", "Hyak Looking East",
 * "SR 18 Westbound". Most names don't (null).
 */
export function facing(name: string): string | null {
	const m =
		name.match(/\b([EWNS])B\b/) ??
		name.match(/\b(east|west|north|south)bound\b/i) ??
		name.match(/\blooking\s+(east|west|north|south)/i);
	return m ? (COMPASS[m[1].toLowerCase()] ?? m[1].toLowerCase()) : null;
}

/** Whether a camera looks back the way you came: a westbound camera when you're going east. */
export function looksBack(name: string, order: RoadOrder, way: 0 | 1): boolean {
	return facing(name) === order.sides[way];
}
