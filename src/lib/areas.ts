import data from '../../data/areas.json';
import { REGIONS } from './regions';

/**
 * A part of the map a list can be narrowed to, so one storm can be shared on its own: each state, then the
 * mountain areas in data/areas.json (the Sierra crosses into Nevada, so a state alone can't say it).
 * Used as `?in=<id>` on the passes and ski areas pages.
 */
export interface Area {
	id: string;
	name: string;
	kind: 'state' | 'mountains';
	/** [west, south, east, north]; mountain areas only (a state uses the state each place is in) */
	bbox?: [number, number, number, number];
}

export const AREAS: Area[] = [
	...REGIONS.map((r) => ({
		id: r.name.toLowerCase().replace(/\s+/g, '-'),
		name: r.name,
		kind: 'state' as const
	})),
	...(data.areas as { id: string; name: string; bbox: [number, number, number, number] }[]).map(
		(a) => ({ ...a, kind: 'mountains' as const })
	)
];

/** The area named in an address (`?in=sierra`), or null for everywhere (or a name we don't know). */
export const areaById = (id: string | null) => AREAS.find((a) => a.id === id) ?? null;

/** Is a place in the area? `states` are the states it's listed under (Heavenly is in two). */
export function inArea(area: Area, p: { lat: number; lon: number }, states: string[]): boolean {
	if (area.kind === 'state') return states.includes(area.name);
	const [w, s, e, n] = area.bbox!;
	return p.lon >= w && p.lat >= s && p.lon <= e && p.lat <= n;
}
