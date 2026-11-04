import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { makeVideo, videoFile, videoFilter } from './storyVideo';

describe('story videos', () => {
	it('slides each sheet of flakes one screen, under the words', () => {
		const filter = videoFilter(1920);
		expect(filter).toContain('mod(t*120\\,1920)-1920');
		expect(filter.match(/overlay=/g)).toHaveLength(4);
		expect(filter.endsWith('[s3][4:v]overlay=format=auto,format=yuv420p[out]')).toBe(true);
	});

	it('serves only names it made, never a path', () => {
		expect(videoFile('0123456789abcdef01234567.mp4')).toContain('story-video');
		expect(videoFile('../stats.json')).toBeNull();
		expect(videoFile('0123456789abcdef01234567.mp4/../../x')).toBeNull();
	});

	it('makes an MP4 from a card', async () => {
		const flat = (alpha: number) =>
			sharp({
				create: { width: 180, height: 320, channels: 4, background: { r: 9, g: 30, b: 50, alpha } }
			})
				.png()
				.toBuffer();
		const dir = mkdtempSync(path.join(tmpdir(), 'video-test-'));
		const file = path.join(dir, 'story.mp4');
		try {
			await makeVideo(
				{ width: 180, height: 320, base: await flat(1), top: await flat(0), snowing: true },
				file
			);
			expect(existsSync(file)).toBe(true);
			expect(statSync(file).size).toBeGreaterThan(1000);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 60000);
});
