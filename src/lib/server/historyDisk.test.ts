import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The replay folder is read when the module loads, so this file sets it first and imports afterwards.
const dir = mkdtempSync(path.join(tmpdir(), 'replay-'));
vi.stubEnv('HISTORY_DIR', dir);
const { getFrame, listFrames, loadSaved } = await import('./history');

const CAM = 'wsdot-us2-mp63-big-windy';
const hash = (n: number) => String(n).repeat(40).slice(0, 40);

describe('replay on disk', () => {
	it('reads saved pictures back after a restart, and removes old ones and cameras no longer recorded', async () => {
		const now = 10 * 3600_000;
		mkdirSync(path.join(dir, CAM), { recursive: true });
		mkdirSync(path.join(dir, 'gone-camera'), { recursive: true });
		const fresh = now - 10 * 60_000;
		const old = now - 8 * 3600_000;
		writeFileSync(path.join(dir, CAM, `${fresh}-${hash(1)}.jpg`), Buffer.from([7, 8]));
		writeFileSync(path.join(dir, CAM, `${old}-${hash(2)}.jpg`), Buffer.from([9]));
		writeFileSync(path.join(dir, CAM, 'not-a-picture.txt'), 'x');

		await loadSaved(now);
		expect(listFrames(CAM)).toEqual([{ t: fresh }]);
		expect([...((await getFrame(CAM, fresh)) ?? [])]).toEqual([7, 8]);
		// Deleting happens in the background.
		await new Promise((r) => setTimeout(r, 50));
		expect(existsSync(path.join(dir, CAM, `${old}-${hash(2)}.jpg`))).toBe(false);
		expect(existsSync(path.join(dir, 'gone-camera'))).toBe(false);
	});

	it('keeps pictures already in memory when reading the folder again', async () => {
		const now = 10 * 3600_000;
		const later = now - 5 * 60_000;
		writeFileSync(path.join(dir, CAM, `${later}-${hash(3)}.jpg`), Buffer.from([1]));
		await loadSaved(now);
		expect(listFrames(CAM)?.map((f) => f.t)).toEqual([now - 10 * 60_000, later]);
	});
});
