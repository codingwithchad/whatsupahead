// Instagram and Threads say a post isn't ready in words that sound final: "Media ID is not available" or "The
// requested resource does not exist", even right after saying it was ready. Both mean "not yet": nothing went up,
// so asking again a little later is safe. Any other failure, a timeout above all, may have posted, so it is never
// asked again.

const NOT_YET = /media id is not available|requested resource does not exist|not ready/i;

export const notReadyYet = (err: unknown) => NOT_YET.test((err as Error)?.message ?? '');

/** `step`, asked again after `pause` while the answer is "not yet", `tries` times in all. */
export async function whenReady<T>(step: () => Promise<T>, tries = 4, pause = 10_000): Promise<T> {
	for (let attempt = 1; ; attempt++)
		try {
			return await step();
		} catch (err) {
			if (attempt >= tries || !notReadyYet(err)) throw err;
			await new Promise((r) => setTimeout(r, pause));
		}
}
