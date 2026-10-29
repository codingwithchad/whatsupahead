import { describe, expect, it } from 'vitest';
import { areaById } from './areas';
import type { PostEntry } from './autopost';
import type { SkiSnow } from './server/skiSnow';
import { names, skiAreasIn, topSnow, topSnowDue, topSnowText, worthPosting } from './topSnow';

const HOUR = 3600_000;
// 7 AM Pacific.
const NOW = Date.parse('2026-12-10T07:00:00-08:00');
const TZ = 'America/Los_Angeles';

const snow = (station: string, change24: number, over: Partial<SkiSnow> = {}): SkiSnow => ({
	station,
	stationFeet: 5800,
	miles: 1,
	link: null,
	depthIn: 12,
	change24,
	sinceSix: 0,
	water24: 0.5,
	at: NOW,
	forecastIn: 0,
	timeZone: TZ,
	...over
});
const place = (id: string) => ({ id, name: id });

describe('topSnow', () => {
	it('most new snow first, five at most, only gauges whose water rose too', () => {
		const places = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(place);
		const lines = topSnow(places, {
			a: snow('A', 2),
			b: snow('B', 6),
			c: snow('C', 4),
			d: snow('D', 9, { water24: 0 }),
			e: snow('E', 3),
			f: snow('F', 1),
			g: snow('G', 5),
			h: snow('H', 0)
		});
		expect(lines.map((l) => [l.names, l.inches])).toEqual([
			[['b'], 6],
			[['g'], 5],
			[['c'], 4],
			[['e'], 3],
			[['a'], 2]
		]);
	});

	it('ski areas sharing a gauge share a line', () => {
		const lines = topSnow([place('Alta'), place('Snowbird')], {
			Alta: snow('Snowbird', 8),
			Snowbird: snow('Snowbird', 8)
		});
		expect(lines.map((l) => names(l.names))).toEqual(['Alta and Snowbird']);
	});

	it('posts only when the top has 3 inches or more', () => {
		expect(worthPosting([])).toBe(false);
		expect(worthPosting(topSnow([place('a')], { a: snow('A', 2) }))).toBe(false);
		expect(worthPosting(topSnow([place('a')], { a: snow('A', 3) }))).toBe(true);
	});
});

describe('topSnowText', () => {
	it('names the area, the heights and links its ski areas, most snow first', () => {
		const area = areaById('wa-cascades')!;
		const lines = topSnow([place('White Pass'), place('Crystal Mountain')], {
			'White Pass': snow('W', 6),
			'Crystal Mountain': snow('C', 4, { depthIn: null, stationFeet: 6110 })
		});
		expect(topSnowText(area, lines, 'https://x.com', 'fb')).toBe(
			[
				'❄️ Most new snow in the last 24 hours, Washington Cascades:',
				'1. White Pass: 6 in, 12 in on the ground (gauge at 5,800 ft)',
				'2. Crystal Mountain: 4 in (gauge at 6,110 ft)',
				'',
				"From the USDA snow gauge on each mountain. Resorts' own reports may differ.",
				'',
				'Cameras and snow at every ski area: https://x.com/collections/ski-areas?in=wa-cascades&sort=snow&ref=fb'
			].join('\n')
		);
	});
});

describe('topSnowDue', () => {
	const area = areaById('wa-cascades')!;
	const post = (hoursAgo: number, over: Partial<PostEntry> = {}): PostEntry => ({
		id: 'top:wa-cascades',
		name: '',
		kind: 'top',
		at: NOW - hoursAgo * HOUR,
		text: '',
		post: null,
		dry: false,
		...over
	});

	it('mornings only, once a day; a failed try again after two hours', () => {
		expect(topSnowDue(area, TZ, [], NOW)).toBe(true);
		expect(topSnowDue(area, TZ, [], NOW - 2 * HOUR)).toBe(false);
		expect(topSnowDue(area, TZ, [], NOW + 5 * HOUR)).toBe(false);
		expect(topSnowDue(area, TZ, [post(1)], NOW)).toBe(false);
		expect(topSnowDue(area, TZ, [post(23)], NOW)).toBe(true);
		expect(topSnowDue(area, TZ, [post(3, { error: 'down' })], NOW)).toBe(true);
		expect(topSnowDue(area, TZ, [post(1, { id: 'top:sierra' })], NOW)).toBe(true);
	});
});

describe('skiAreasIn', () => {
	it("an area's ski areas and the passes the list also holds", () => {
		const area = areaById('wa-cascades')!;
		const list = skiAreasIn(
			area,
			[
				{ id: 'ski-white-pass', lat: 46.64, lon: -121.39, collection: 'ski-areas' },
				{ id: 'snoqualmie-pass', lat: 47.43, lon: -121.41 },
				{ id: 'leavenworth', lat: 47.6, lon: -120.66 },
				{ id: 'ski-schweitzer', lat: 48.38, lon: -116.61, collection: 'ski-areas' }
			],
			['snoqualmie-pass']
		);
		expect(list.map((p) => p.id)).toEqual(['ski-white-pass', 'snoqualmie-pass']);
	});
});
