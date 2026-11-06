import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(path.join(tmpdir(), 'instagram-'));
vi.stubEnv('INSTAGRAM_TOKEN', 'test');
vi.stubEnv('STATS_FILE', path.join(dir, 'stats.json'));
vi.mock('./sharePictures', () => ({ drawFirst: vi.fn(), storyLayers: async () => null }));

const { storyRun } = await import('./instagram');
const { drawFirst } = await import('./sharePictures');

/** Instagram, refusing the first `refuse` pictures as it does a slow one. */
function instagram(refuse: number) {
	const calls: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			const { pathname } = new URL(url);
			calls.push(pathname.split('/').pop()!);
			const answer = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
			if (pathname.endsWith('/me')) return answer({ user_id: '1' });
			if (pathname.endsWith('/media_publish')) return answer({ id: 'story' });
			if (pathname.endsWith('/media'))
				return refuse-- > 0
					? answer({ error: { message: 'Only photo or video can be accepted' } }, 400)
					: answer({ id: 'draft' });
			return answer({ status_code: 'FINISHED' });
		})
	);
	return calls;
}

const story = { id: 'chinook', name: 'Chinook Pass', kind: 'chains' as const, picture: '/og/x' };
const log = () =>
	JSON.parse(readFileSync(path.join(dir, 'instagram-stories.json'), 'utf8')) as {
		media: string | null;
		error?: string;
	}[];

describe('posting a story', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.mocked(drawFirst).mockClear();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('draws the picture before Instagram asks for it', async () => {
		instagram(0);
		await storyRun([story], 1);
		expect(drawFirst).toHaveBeenCalledOnce();
		expect(log().at(-1)?.media).toBe('story');
	});

	it('tries again when a picture is refused, and goes up only once', async () => {
		const calls = instagram(2);
		const run = storyRun([story], 1);
		await vi.runAllTimersAsync();
		await run;
		expect(calls.filter((c) => c === 'media')).toHaveLength(3);
		expect(calls.filter((c) => c === 'media_publish')).toHaveLength(1);
		expect(log().at(-1)?.media).toBe('story');
	});

	it('gives up after three tries and says why', async () => {
		const calls = instagram(5);
		const run = storyRun([story], 1);
		await vi.runAllTimersAsync();
		await run;
		expect(calls.filter((c) => c === 'media')).toHaveLength(3);
		expect(calls).not.toContain('media_publish');
		expect(log().at(-1)?.error).toContain('Only photo or video');
	});
});
