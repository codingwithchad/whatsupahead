import { describe, expect, it } from 'vitest';
import { notReadyYet, whenReady } from './metaReady';

describe('waiting for Instagram and Threads', () => {
	it('reads their "not yet" words as not yet', () => {
		expect(notReadyYet(new Error('Media ID is not available'))).toBe(true);
		expect(notReadyYet(new Error('The requested resource does not exist'))).toBe(true);
		expect(notReadyYet(new Error('The operation was aborted due to timeout'))).toBe(false);
		expect(notReadyYet(new Error('Invalid OAuth access token'))).toBe(false);
	});

	it('asks again while not ready, then gives the answer', async () => {
		let asked = 0;
		const id = await whenReady(
			async () => {
				if (++asked < 3) throw new Error('Media ID is not available');
				return 'posted';
			},
			4,
			1
		);
		expect(id).toBe('posted');
		expect(asked).toBe(3);
	});

	it('never asks again after a failure that may have posted', async () => {
		let asked = 0;
		await expect(
			whenReady(
				async () => {
					asked++;
					throw new Error('The operation was aborted due to timeout');
				},
				4,
				1
			)
		).rejects.toThrow('timeout');
		expect(asked).toBe(1);
	});

	it('gives up after its tries', async () => {
		let asked = 0;
		await expect(
			whenReady(
				async () => {
					asked++;
					throw new Error('The requested resource does not exist');
				},
				3,
				1
			)
		).rejects.toThrow('does not exist');
		expect(asked).toBe(3);
	});
});
