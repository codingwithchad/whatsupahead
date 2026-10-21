import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COVERAGE, REGIONS } from '../regions';
import { AREAS, inArea } from '../areas';
import { dataFiles } from './catalog';

// Every file in data/ must match its schema, and the files must agree with each other. This is what
// makes a data-only pull request safe to review: if these pass, the data is well formed.

const root = process.cwd();
const FOLDERS: Record<string, string> = {
	cameras: 'camera',
	'weather-sources': 'weather-source',
	places: 'place',
	collections: 'collection',
	drives: 'drive',
	passes: 'pass'
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const data: Record<string, { file: string; item: Record<string, any> }[]> = {};
for (const [folder, schemaName] of Object.entries(FOLDERS)) {
	const validate = ajv.compile(json(path.join(root, 'schema', `${schemaName}.schema.json`)));
	data[folder] = dataFiles(folder).map((file) => ({
		file,
		item: json(path.join(root, 'data', folder, file))
	}));
	describe(`data/${folder}`, () => {
		it('every file matches its schema and is named after its id', () => {
			const problems: string[] = [];
			for (const { file, item } of data[folder]) {
				if (!validate(item)) problems.push(`${file}: ${ajv.errorsText(validate.errors)}`);
				if (item.id !== path.basename(file, '.json'))
					problems.push(`${file}: id "${item.id}" must match the file name`);
			}
			expect(problems).toEqual([]);
		});
		it('ids are unique across region folders and sit in a known region folder', () => {
			const folders = new Set(REGIONS.map((r) => r.folder));
			const seen = new Set<string>();
			const problems: string[] = [];
			for (const { file, item } of data[folder]) {
				if (seen.has(item.id)) problems.push(`${file}: id "${item.id}" is used twice`);
				seen.add(item.id);
				const sub = file.includes('/') ? file.split('/')[0] : null;
				if (sub && !folders.has(sub))
					problems.push(`${file}: "${sub}" is not a region folder in data/regions.json`);
			}
			expect(problems).toEqual([]);
		});
	});
}

describe('data agrees with itself', () => {
	const ids = (folder: string) => new Set(data[folder].map((d) => d.item.id as string));

	it('camera feed addresses are secure and unique', () => {
		const seen = new Map<string, string>();
		const problems: string[] = [];
		for (const { file, item } of data.cameras) {
			if (!item.feed_url) continue;
			if (!/^https:\/\//.test(item.feed_url)) problems.push(`${file}: feed_url must be https`);
			if (seen.has(item.feed_url))
				problems.push(`${file}: same feed as ${seen.get(item.feed_url)}`);
			seen.set(item.feed_url, file);
		}
		expect(problems).toEqual([]);
	});

	it('coordinates are inside their region (catches swapped latitude and longitude)', () => {
		const problems: string[] = [];
		const byFolder = new Map(REGIONS.map((r) => [r.folder, r.bbox]));
		// A little slack: cameras on a border river or a pass road can sit just outside the state line.
		const near = (b: number[], lat: number, lon: number) =>
			lon >= b[0] - 0.3 && lat >= b[1] - 0.3 && lon <= b[2] + 0.3 && lat <= b[3] + 0.3;
		for (const folder of ['cameras', 'weather-sources', 'places', 'passes']) {
			for (const { file, item } of data[folder]) {
				const box = byFolder.get(file.split('/')[0]) ?? COVERAGE;
				if (!near(box, item.lat, item.lon))
					problems.push(`${folder}/${file}: ${item.lat}, ${item.lon}`);
			}
		}
		expect(problems).toEqual([]);
	});

	it('references point at things that exist', () => {
		const problems: string[] = [];
		const places = ids('places');
		const collections = ids('collections');
		for (const { file, item } of data.places)
			if (item.collection && !collections.has(item.collection))
				problems.push(`places/${file}: unknown collection ${item.collection}`);
		for (const { file, item } of data.collections)
			for (const p of item.also ?? [])
				if (!places.has(p)) problems.push(`collections/${file}: unknown place ${p}`);
		for (const { file, item } of data.passes)
			if (!places.has(item.place)) problems.push(`passes/${file}: unknown place ${item.place}`);
		for (const { file, item } of data.drives)
			for (const end of [item.from, item.to])
				if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(end) && !places.has(end))
					problems.push(`drives/${file}: unknown place ${end}`);
		expect(problems).toEqual([]);
	});

	it('mountain areas (data/areas.json) have unique ids and each holds a pass or ski area', () => {
		const problems: string[] = [];
		const seen = new Set<string>();
		for (const a of AREAS) {
			if (seen.has(a.id)) problems.push(`areas: id "${a.id}" is used twice`);
			seen.add(a.id);
			if (a.kind === 'state') continue;
			const [w, s, e, n] = a.bbox!;
			if (!(w < e && s < n)) problems.push(`areas: ${a.id} box is [west, south, east, north]`);
			const held = [...data.passes, ...data.places]
				.map((d) => d.item)
				.filter((p) => !('collection' in p) || p.collection === 'ski-areas');
			if (!held.some((p) => inArea(a, p as { lat: number; lon: number }, [])))
				problems.push(`areas: ${a.id} holds no pass or ski area`);
		}
		expect(problems).toEqual([]);
	});

	it('roads that close for the winter give their usual closing days', () => {
		const missing = data.passes
			.filter(({ item }) => item.winter_closure && !item.seasonal_closure)
			.map(({ file }) => file);
		expect(missing).toEqual([]);
	});

	it('cameras that need a provider or are seasonal say so', () => {
		const problems: string[] = [];
		for (const { file, item } of data.cameras) {
			if (!item.feed_url && !item.provider && item.availability !== 'seasonal')
				problems.push(`cameras/${file}: needs feed_url, provider or seasonal availability`);
		}
		expect(problems).toEqual([]);
	});
});
