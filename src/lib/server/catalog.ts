import { nearestTown } from './gazetteer';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Camera, Collection, Drive, PassInfo, FeaturedPlace, WeatherSource } from '../types';

function dataDir(): string {
	return process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
}

/**
 * The JSON files in a data folder and in its region subfolders (data/cameras/us-wa/..., data/cameras/us-or/...),
 * as paths relative to the folder.
 */
export function dataFiles(folder: string): string[] {
	const dir = path.join(dataDir(), folder);
	try {
		return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
			entry.isDirectory()
				? readdirSync(path.join(dir, entry.name))
						.filter((n) => n.endsWith('.json'))
						.map((n) => `${entry.name}/${n}`)
				: entry.name.endsWith('.json')
					? [entry.name]
					: []
		);
	} catch {
		return [];
	}
}

/** Read every JSON file in a data folder (and its region subfolders). Bad files are skipped with a warning. */
export function readFolder<T extends { id: string }>(folder: string): T[] {
	const dir = path.join(dataDir(), folder);
	const items: T[] = [];
	for (const name of dataFiles(folder)) {
		try {
			const item = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as T;
			if (item.id !== path.basename(name, '.json')) {
				console.warn(`[catalog] ${folder}/${name}: id does not match filename, skipped`);
				continue;
			}
			items.push(item);
		} catch (err) {
			console.warn(`[catalog] ${folder}/${name}: ${(err as Error).message}`);
		}
	}
	return items;
}

let cache: {
	cameras: Camera[];
	weather: WeatherSource[];
	places: FeaturedPlace[];
	collections: Collection[];
	drives: Drive[];
	passes: PassInfo[];
} | null = null;

/** Approved items only. Loaded once per server start. */
export function getCatalog() {
	if (!cache) {
		cache = {
			collections: readFolder<Collection>('collections').sort(
				(a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name)
			),
			drives: readFolder<Drive>('drives').sort(
				(a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name)
			),
			passes: readFolder<PassInfo>('passes'),
			places: readFolder<FeaturedPlace>('places').sort(
				(a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name)
			),
			cameras: readFolder<Camera & { status: string }>('cameras')
				.filter((c) => c.status === 'approved')
				.map(withTown),
			weather: readFolder<WeatherSource & { status: string }>('weather-sources').filter(
				(w) => w.status === 'approved'
			)
		};
	}
	return cache;
}

// "I-84 at MP 267" says nothing to most people: name the nearest town too ("I-84 at MP 267 (near Pendleton)").
const MILEPOST_ONLY =
	/^(I|SR|US|OR|CA|ID|NV|Hwy|Highway)[- ]?\d+[A-Z]?( (at|@) ?| )(MP|milepost|mile post) ?[\d.]+$/i;

/** A camera named only by its road and milepost, with the nearest town added. */
export function withTown<T extends Camera>(c: T): T {
	if (!MILEPOST_ONLY.test(c.name)) return c;
	const town = nearestTown(c);
	return town ? { ...c, name: `${c.name} (near ${town})` } : c;
}
