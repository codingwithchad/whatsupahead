import { BlockList, isIP } from 'node:net';
import { currentVisitor } from './visitor';

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

// Cloudflare's addresses (cloudflare.com/ips, checked 2026-10-13). When the proxy in front of the app was reached
// from one of them, the visitor came through Cloudflare, which names them in CF-Connecting-IP.
const CLOUDFLARE = new BlockList();
for (const range of [
	'173.245.48.0/20',
	'103.21.244.0/22',
	'103.22.200.0/22',
	'103.31.4.0/22',
	'141.101.64.0/18',
	'108.162.192.0/18',
	'190.93.240.0/20',
	'188.114.96.0/20',
	'197.234.240.0/22',
	'198.41.128.0/17',
	'162.158.0.0/15',
	'104.16.0.0/13',
	'104.24.0.0/14',
	'172.64.0.0/13',
	'131.0.72.0/22'
])
	CLOUDFLARE.addSubnet(range.split('/')[0], Number(range.split('/')[1]), 'ipv4');
for (const range of [
	'2400:cb00::/32',
	'2606:4700::/32',
	'2803:f800::/32',
	'2405:b500::/32',
	'2405:8100::/32',
	'2a06:98c0::/29',
	'2c0f:f248::/32'
])
	CLOUDFLARE.addSubnet(range.split('/')[0], Number(range.split('/')[1]), 'ipv6');

/** Whether an address is one of Cloudflare's. */
export function isCloudflare(address: string): boolean {
	const kind = isIP(address);
	return kind !== 0 && CLOUDFLARE.check(address, kind === 6 ? 'ipv6' : 'ipv4');
}

/**
 * The visitor's address, for rate limits. Behind a proxy the left of X-Forwarded-For is whatever the visitor
 * chose to send, so count from the right instead: each proxy we sit behind adds one real entry there.
 * TRUSTED_PROXIES is how many entries the proxies in front of the app add (1 unless set): Azure App Service adds 1
 * (measured through /healthz "forwarded_hops", 2026-10-10). Check it again after moving hosts.
 * Without enough entries (local runs), the connection's own address is used.
 * Through Cloudflare, that entry is a Cloudflare address shared by many visitors; Cloudflare's CF-Connecting-IP
 * names the visitor, and is trusted only then (anyone reaching the app directly could send one).
 */
export function visitorAddress(request: Request, connection: () => string): string {
	const proxies = Math.max(1, Number(process.env.TRUSTED_PROXIES) || 1);
	const list = (request.headers.get('x-forwarded-for') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const peer = list.length >= proxies ? withoutPort(list[list.length - proxies]) : connection();
	const visitor = request.headers.get('cf-connecting-ip')?.trim();
	return visitor && isIP(visitor) && isCloudflare(peer) ? visitor : peer;
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

/**
 * Whether the visitor this work is for may start one more fresh call to a free service everyone shares (routing,
 * place search). Answers already kept in the cache don't count. Background jobs (no visitor) always may.
 * Checked before the service's overall limit, so one visitor (or bot) can't use up what everyone else needs.
 */
export function visitorAllowed(service: string, limit: number, windowMs = 60_000): boolean {
	const who = currentVisitor();
	return !who || allow(`visitor:${service}:${who}`, limit, windowMs);
}

/**
 * What a visitor over a limit gets: a short page with a way back when they opened a page, plain text for
 * everything else (pictures, data the app fetches). Never kept by Cloudflare or the browser.
 */
export function tooManyRequests(request: Request): Response {
	const headers: Record<string, string> = {
		'retry-after': '60',
		'cache-control': 'no-store',
		'cdn-cache-control': 'no-store',
		'x-content-type-options': 'nosniff'
	};
	const dest = request.headers.get('sec-fetch-dest');
	const wantsPage =
		(request.headers.get('accept') ?? '').includes('text/html') && (!dest || dest === 'document');
	if (!wantsPage)
		return new Response('Too many requests. Please wait a minute and try again.', {
			status: 429,
			headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' }
		});
	return new Response(TOO_MANY_PAGE, {
		status: 429,
		headers: {
			...headers,
			'content-type': 'text/html; charset=utf-8',
			'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"
		}
	});
}

const TOO_MANY_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Slow down a moment · What's Up Ahead</title>
<style>
body { margin: 0; font: 17px/1.5 system-ui, sans-serif; background: #f6f7f9; color: #1d2430; }
main { max-width: 32rem; margin: 15vh auto 0; padding: 0 16px; }
h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
a { color: #0b5cad; }
@media (prefers-color-scheme: dark) { body { background: #12161c; color: #e6e9ee; } a { color: #7db7ff; } }
</style>
</head>
<body>
<main>
<h1>That was a lot of pages at once</h1>
<p>To keep the free road and weather services working for everyone, each address gets a limited number of new
drives and searches a minute. Please wait a minute, then try again.</p>
<p><a href="/">Back to What's Up Ahead</a></p>
</main>
</body>
</html>
`;
