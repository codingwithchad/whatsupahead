// Add each camera's ground height (`elevation_m`) near ski areas, so a ski area's page can list the cameras on the
// mountain before the ones down in the valley. Heights come from Open-Meteo's free elevation service (a 90 m
// terrain map), 100 cameras a request. Cameras that already have a height are left alone.
// Usage: node scripts/add-camera-heights.mjs [--write]   (rerun after importing cameras near ski areas)
import { readFileSync, writeFileSync } from 'node:fs';
import { dataFiles } from './lib/data.mjs';

const WRITE = process.argv.includes('--write');
const rad = Math.PI / 180;
const miles = (a, b) =>
	Math.hypot((a.lon - b.lon) * Math.cos(a.lat * rad) * 69.05, (a.lat - b.lat) * 69.05);

const ski = dataFiles('places')
	.map((f) => JSON.parse(readFileSync(f, 'utf8')))
	.filter((p) => p.collection === 'ski-areas');
const cameras = dataFiles('cameras').map((file) => ({ file, cam: JSON.parse(readFileSync(file, 'utf8')) }));
const wanted = cameras.filter(
	({ cam }) =>
		cam.elevation_m === undefined &&
		ski.some((p) => miles(cam, p) <= Math.max(p.radius_miles ?? 8, 8) + 2)
);
console.log(`${wanted.length} cameras near ${ski.length} ski areas need a height`);

for (let i = 0; i < wanted.length; i += 100) {
	const batch = wanted.slice(i, i + 100);
	const url = new URL('https://api.open-meteo.com/v1/elevation');
	url.searchParams.set('latitude', batch.map(({ cam }) => cam.lat.toFixed(5)).join(','));
	url.searchParams.set('longitude', batch.map(({ cam }) => cam.lon.toFixed(5)).join(','));
	const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
	if (!res.ok) throw new Error(`elevation service answered ${res.status}`);
	const { elevation } = await res.json();
	batch.forEach(({ file, cam }, k) => {
		const m = elevation[k];
		if (typeof m !== 'number' || Number.isNaN(m)) return;
		cam.elevation_m = Math.round(m);
		if (WRITE) writeFileSync(file, JSON.stringify(cam, null, 2) + '\n');
	});
	await new Promise((r) => setTimeout(r, 1000));
}
console.log(WRITE ? 'written' : 'dry run: add --write to save');
