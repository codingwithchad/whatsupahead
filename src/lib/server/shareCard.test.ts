import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { fit, grid, HEIGHT, renderCard, textWidth, WIDTH, wrap } from './shareCard';

describe('text layout', () => {
	it('measures, shortens and wraps', () => {
		expect(textWidth('Snoqualmie Pass', 40, 'bold')).toBeGreaterThan(200);
		const short = fit('Government Camp (Mount Hood) and beyond', 24, 200);
		expect(short.endsWith('…')).toBe(true);
		expect(textWidth(short, 24)).toBeLessThanOrEqual(200);
		const lines = wrap(
			'Ski areas in Washington, Oregon and California: roads, cameras and forecasts',
			26,
			380,
			2
		);
		expect(lines).toHaveLength(2);
		expect(lines[1].endsWith('…')).toBe(true);
	});
	it('keeps a time like "9:26 AM" on one line', () => {
		const lines = wrap('Mon, Oct 12, 9:26 AM', 20, 150, 3);
		expect(lines.some((l) => l.includes('9:26 AM'))).toBe(true);
	});
});

describe('grid', () => {
	it('splits the picture area into tiles', () => {
		const area = { x: 0, y: 0, w: 672, h: 534 };
		expect(grid(1, area)).toEqual([area]);
		expect(grid(2, area)).toHaveLength(2);
		const three = grid(3, area);
		expect(three[0].w).toBe(672);
		expect(three[1].w).toBeLessThan(672);
		expect(grid(4, area)).toHaveLength(4);
	});
});

describe('renderCard', () => {
	const picture = () =>
		sharp({ create: { width: 320, height: 260, channels: 3, background: '#4a7a3a' } })
			.jpeg()
			.toBuffer();

	it('draws a 1200 by 630 picture with a camera picture', async () => {
		const out = await renderCard({
			title: 'I-90 at MP 52: Snoqualmie Summit',
			lines: ['Live camera near Snoqualmie Pass'],
			credit: 'Picture: WSDOT',
			pictures: [{ image: await picture() }],
			site: 'example.com'
		});
		const meta = await sharp(out).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', WIDTH, HEIGHT]);
	});

	it('draws a drive with its map, and a card with no picture at all', async () => {
		const drive = await renderCard({
			title: 'Everett to Leavenworth',
			lines: ['101 mi · about 1 h 55 min'],
			pictures: [{ image: await picture(), caption: 'Stevens Pass' }],
			map: {
				route: [
					[47.98, -122.2],
					[47.75, -121.09],
					[47.6, -120.66]
				],
				from: 'Everett',
				to: 'Leavenworth',
				marks: [{ lat: 47.75, lon: -121.09, label: 'Stevens Pass' }]
			},
			site: 'example.com'
		});
		const plain = await renderCard({
			title: 'Salem weather camera',
			lines: [],
			pictures: [{ image: Buffer.from('not a picture') }],
			site: 'example.com'
		});
		for (const out of [drive, plain]) expect((await sharp(out).metadata()).width).toBe(WIDTH);
	});
});
