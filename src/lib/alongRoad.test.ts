import { describe, expect, it } from 'vitest';
import { getCatalog } from './server/catalog';
import { distanceMiles } from './geo';
import { alongRoad, facing, inRoadOrder, looksBack, type RoadOrder } from './alongRoad';

describe('cameras along a pass', () => {
	const { passes, cameras } = getCatalog();
	const near = (id: string) => {
		const pass = passes.find((p) => p.id === id)!;
		return {
			pass,
			cams: cameras.filter((c) => c.route && distanceMiles(c, pass) <= 9)
		};
	};

	it('lists Snoqualmie cameras west to east by milepost going east, and back going west', () => {
		const { pass, cams } = near('snoqualmie');
		const order = alongRoad(cams, pass)!;
		expect(order.ways).toEqual(['Eastbound', 'Westbound']);
		const posts = inRoadOrder(cams, order, 0)
			.map((x) => x.camera.milepost)
			.filter((m) => m !== undefined);
		expect(posts.length).toBeGreaterThan(10);
		for (let i = 1; i < posts.length; i++)
			expect(posts[i]).toBeGreaterThanOrEqual(posts[i - 1]! - 1);
		const back = inRoadOrder(cams, order, 1);
		expect(back[0].note).toMatch(/east of the summit/);
	});

	it('names an odd interstate north and south', () => {
		const { pass, cams } = near('siskiyou');
		expect(alongRoad(cams, pass)?.ways).toEqual(['Northbound', 'Southbound']);
	});

	it('has no order for a pass without a saved road', () => {
		const { pass, cams } = near('ebbetts');
		expect(alongRoad(cams, pass)).toBeNull();
	});

	it('reads which way a camera looks from its name', () => {
		expect(facing('Hwy 80 at Kingvale WB (Soda Springs)')).toBe('west');
		expect(facing('EB 108 W/O Soulsbyville Rd')).toBe('east');
		expect(facing('Hyak Looking West-Northwest')).toBe('west');
		expect(facing('SR 18 Westbound at Tiger')).toBe('west');
		expect(facing('I-90 at MP 52: Snoqualmie Summit')).toBeNull();
		expect(facing('Blue Diamond Rd & Buffalo Dr')).toBeNull();
		const order: RoadOrder = { ways: ['Eastbound', 'Westbound'], sides: ['west', 'east'], at: {} };
		expect(looksBack('Kingvale WB', order, 0)).toBe(true);
		expect(looksBack('Kingvale WB', order, 1)).toBe(false);
	});
});
