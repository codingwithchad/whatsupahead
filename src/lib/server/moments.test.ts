import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { _addFrameForTest } from './history';

process.env.MOMENTS_DIR = mkdtempSync(path.join(tmpdir(), 'moments-'));
const { canShareMoment, getMoment, momentPicture, saveMoment } = await import('./moments');

const CAM = 'wsdot-i90-mp52-snoqualmie-summit';
_addFrameForTest(CAM, { t: 1000, hash: 'a', jpeg: Buffer.from([1, 2, 3]) });
_addFrameForTest(CAM, { t: 9000, hash: 'b', jpeg: Buffer.from([4, 5, 6]) });

describe('moments', () => {
	it('saves two replay pictures under one link, and the same pair gets the same link', async () => {
		const m = await saveMoment(CAM, 1000, 9000);
		expect(m?.id).toMatch(/^[a-f0-9]{12}$/);
		expect((await saveMoment(CAM, 1000, 9000))?.id).toBe(m?.id);
		expect(getMoment(m!.id)).toMatchObject({ camera: CAM, before: 1000, after: 9000 });
		expect([...momentPicture(m!.id, 'before')!]).toEqual([1, 2, 3]);
		expect([...momentPicture(m!.id, 'after')!]).toEqual([4, 5, 6]);
	});

	it('refuses cameras that cannot be shared, pictures that are gone, and odd requests', async () => {
		expect(canShareMoment('three-rivers')).toBe(false);
		expect(await saveMoment('three-rivers', 1000, 9000)).toBeNull();
		expect(await saveMoment(CAM, 9000, 1000)).toBeNull();
		expect(await saveMoment(CAM, 1000, 5555)).toBeNull();
		expect(getMoment('../../etc/passwd')).toBeNull();
		expect(momentPicture('nope', 'before')).toBeNull();
	});
});
