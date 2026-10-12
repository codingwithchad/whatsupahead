const hits = new Map<string, { windowMs: number; times: number[] }>();

/** Allow at most `limit` calls per `windowMs` for a key (for example a visitor's address). Returns false when over. */
export function allow(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
	const recent = (hits.get(key)?.times ?? []).filter((t) => now - t < windowMs);
	const allowed = recent.length < limit;
	if (allowed) recent.push(now);
	hits.set(key, { windowMs, times: recent });
	if (hits.size > 5000)
		for (const [k, v] of hits) if (!v.times.some((t) => now - t < v.windowMs)) hits.delete(k);
	return allowed;
}

/**
 * The visitor's address, for rate limits. Behind a proxy the left of X-Forwarded-For is whatever the visitor
 * chose to send, so count from the right instead: each proxy we sit behind adds one real entry there.
 * TRUSTED_PROXIES is how many entries the proxies in front of the app add. Render adds 3 (measured on the live
 * site through /healthz "forwarded_hops", 2026-10-09); Azure App Service adds 1 (2026-10-10). Check it again after moving hosts or adding a CDN.
 * Without enough entries (local runs), the connection's own address is used.
 */
export function visitorAddress(request: Request, connection: () => string): string {
	const proxies = Math.max(1, Number(process.env.TRUSTED_PROXIES) || 3);
	const list = (request.headers.get('x-forwarded-for') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return list.length >= proxies ? withoutPort(list[list.length - proxies]) : connection();
}

/** Azure App Service writes "203.0.113.5:51234" (and "[2001:db8::1]:51234"); the port changes per connection. */
export function withoutPort(address: string): string {
	const v6 = address.match(/^\[([^\]]+)\](?::\d+)?$/);
	if (v6) return v6[1];
	return /^[\d.]+:\d+$/.test(address) ? address.slice(0, address.lastIndexOf(':')) : address;
}

/**
 * Open-Meteo's free forecast allows about 10,000 calls a day for everyone using this app. Stay well under it,
 * and under a steady rate, whatever visitors (or bots) do; past it, forecasts are left out until it frees up.
 */
export function openMeteoAllowed(): boolean {
	return (
		allow('upstream:open-meteo-forecast', 120) && allow('upstream:open-meteo-day', 8000, 86_400_000)
	);
}
