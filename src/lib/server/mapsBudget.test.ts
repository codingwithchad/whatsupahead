import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const file = path.join(mkdtempSync(path.join(tmpdir(), 'maps-')), 'usage.json');
process.env.AZURE_MAPS_USAGE_FILE = file;
const { _resetMapsUsage, limits, mapsUsage, takeMapsRequest } = await import('./mapsBudget');

describe('Azure Maps budget', () => {
	it('stays inside the free monthly amounts, a few days at a time', () => {
		expect(limits('route')).toEqual({ month: 900, day: 90 });
		expect(limits('search').month).toBe(4500);
	});

	it('stops at the day limit, starts again the next day, and survives a restart', () => {
		const day1 = Date.parse('2026-10-12T12:00:00Z');
		let n = 0;
		while (takeMapsRequest('weather', day1)) n++;
		expect(n).toBe(90);
		// A restart reads the saved count back.
		_resetMapsUsage();
		expect(takeMapsRequest('weather', day1)).toBe(false);
		expect(JSON.parse(readFileSync(file, 'utf8')).monthly.weather).toBe(90);
		expect(takeMapsRequest('weather', day1 + 24 * 60 * 60_000)).toBe(true);
		expect(mapsUsage(day1 + 24 * 60 * 60_000).find((m) => m.kind === 'weather')).toMatchObject({
			month: 91,
			today: 1
		});
	});

	it('starts each month at zero', () => {
		expect(takeMapsRequest('route', Date.parse('2026-11-01T00:30:00Z'))).toBe(true);
		expect(mapsUsage(Date.parse('2026-11-01T01:00:00Z'))[0]).toMatchObject({ month: 1, today: 1 });
	});
});
