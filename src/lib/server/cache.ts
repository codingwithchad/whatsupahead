const store = new Map<string, { at: number; value: unknown; bytes: number }>();
const inFlight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 2000;
// Pictures are the big entries; keep their total well inside a small server's memory.
const MAX_BYTES = 64 * 1024 * 1024;
let bytes = 0;

const sizeOf = (value: unknown) => (value instanceof Uint8Array ? value.byteLength : 0);

/** Store a value, dropping the oldest entries while over the entry or byte limit. */
function put(key: string, value: unknown) {
	const old = store.get(key);
	if (old) {
		bytes -= old.bytes;
		store.delete(key);
	}
	const size = sizeOf(value);
	while (store.size && (store.size >= MAX_ENTRIES || bytes + size > MAX_BYTES)) {
		const [oldest, entry] = store.entries().next().value as [string, { bytes: number }];
		bytes -= entry.bytes;
		store.delete(oldest);
	}
	store.set(key, { at: Date.now(), value, bytes: size });
	bytes += size;
}

/**
 * Tiny in-memory cache so upstream APIs are hit at most once per `ttlMs` per key.
 * If many requests ask for the same thing while it is being fetched, they all wait for that one
 * fetch instead of each starting their own. Failures are shared with the waiters but never kept.
 */
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
	const hit = store.get(key);
	if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value as T);
	const pending = inFlight.get(key);
	if (pending) return pending as Promise<T>;

	const promise = (async () => {
		try {
			const value = await load();
			put(key, value);
			return value;
		} finally {
			inFlight.delete(key);
		}
	})();
	inFlight.set(key, promise);
	return promise;
}

/**
 * Like `cached`, for many keys at once: fresh entries come from memory and all the missing ones are loaded in
 * one call (for APIs that answer many ids per request). Missing keys that `load` does not return stay missing.
 */
export async function cachedMany<T>(
	keys: string[],
	ttlMs: number,
	load: (missing: string[]) => Promise<Map<string, T>>
): Promise<Map<string, T>> {
	const out = new Map<string, T>();
	const missing: string[] = [];
	for (const key of new Set(keys)) {
		const hit = store.get(key);
		if (hit && Date.now() - hit.at < ttlMs) out.set(key, hit.value as T);
		else missing.push(key);
	}
	if (missing.length) {
		for (const [key, value] of await load(missing)) {
			put(key, value);
			out.set(key, value);
		}
	}
	return out;
}

/** How much picture data is held right now (for /healthz). */
export const cacheBytes = () => bytes;

/** For tests: forget everything. */
export function clearCache() {
	store.clear();
	inFlight.clear();
	bytes = 0;
}

/**
 * Like `cached`, but once a value is past `ttlMs` the old one is returned at once while a fresh one loads in
 * the background, so no visitor waits on a slow upstream. Past `maxStaleMs` it waits for the fresh value.
 */
export function cachedStale<T>(
	key: string,
	ttlMs: number,
	load: () => Promise<T>,
	maxStaleMs = 60 * 60 * 1000
): Promise<T> {
	const hit = store.get(key);
	const age = hit ? Date.now() - hit.at : Infinity;
	if (hit && age >= ttlMs && age < maxStaleMs) {
		if (!inFlight.has(key)) cached(key, 0, load).catch(() => {});
		return Promise.resolve(hit.value as T);
	}
	return cached(key, ttlMs, load);
}
