import { REPO_URL } from '../brand';
import { getCatalog } from './catalog';

// Is each outside source still answering? Every half hour the server makes one small request to each (the same
// kind the app makes), and /healthz reports the results. A daily GitHub Action reads them and opens an issue
// when one keeps failing or the GitHub token is about to expire (see .github/workflows/health.yml).

export type SourceStatus = 'ok' | 'failing' | 'unknown' | 'not-configured';

export interface SourceHealth {
	status: SourceStatus;
	checked_at: string | null;
	last_ok: string | null;
	/** Failures in a row; the alert waits for two so one blip does not open an issue. */
	failures_in_a_row: number;
	/** Our own short description of the last problem (never a URL, which could contain a key). */
	problem?: string;
}

interface Check {
	name: string;
	/** Throws (or returns a problem) when the source is not working. Returns null when it is not set up. */
	run: () => Promise<string | void | null>;
}

const UA = { 'User-Agent': 'WhatsUpAhead (https://github.com/codingwithchad/whatsupahead)' };
const EVERY_MS = 30 * 60 * 1000;
const state = new Map<string, SourceHealth>();
let githubTokenDays: number | null = null;

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
	const res = await fetch(url, {
		headers: { ...UA, ...headers },
		signal: AbortSignal.timeout(10000)
	});
	if (!res.ok) throw new Error(`answered ${res.status}`);
	return res;
}

const CHECKS: Check[] = [
	{
		name: 'wsdot',
		run: async () => {
			const key = process.env.WSDOT_CODE;
			if (!key) return null;
			const body = await (
				await get(
					`https://wsdot.wa.gov/Traffic/api/BorderCrossings/BorderCrossingsREST.svc/GetBorderCrossingsAsJson?AccessCode=${encodeURIComponent(key)}`
				)
			).json();
			if (!Array.isArray(body)) return 'unexpected answer (key may be invalid)';
		}
	},
	{
		name: 'wsdot-ferries',
		run: async () => {
			const key = process.env.WSDOT_CODE;
			if (!key) return null;
			const body = await (
				await get(
					`https://www.wsdot.wa.gov/ferries/api/terminals/rest/terminalsailingspace/1?apiaccesscode=${encodeURIComponent(key)}`
				)
			).json();
			if (!Array.isArray(body?.DepartingSpaces)) return 'unexpected answer (key may be invalid)';
		}
	},
	{
		name: 'windy',
		run: async () => {
			const key = process.env.WINDY_API_KEY;
			const cam = getCatalog().cameras.find((c) => c.provider === 'windy' && c.provider_ref);
			if (!key || !cam) return null;
			await get(
				`https://api.windy.com/webcams/api/v3/webcams/${encodeURIComponent(cam.provider_ref!)}`,
				{ 'x-windy-api-key': key }
			);
		}
	},
	{
		name: 'tripcheck-pictures',
		run: async () => {
			const cam = getCatalog().cameras.find((c) => c.source === 'ODOT' && c.feed_url);
			if (!cam) return null;
			const bytes = new Uint8Array(await (await get(cam.feed_url!)).arrayBuffer());
			if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return 'picture is not a JPEG';
		}
	},
	{
		name: 'caltrans-pictures',
		run: async () => {
			const cam = getCatalog().cameras.find((c) => c.source === 'Caltrans' && c.feed_url);
			if (!cam) return null;
			const bytes = new Uint8Array(await (await get(cam.feed_url!)).arrayBuffer());
			if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return 'picture is not a JPEG';
		}
	},
	{
		name: 'caltrans-chain-controls',
		run: async () => {
			const body = (await (
				await get('https://cwwp2.dot.ca.gov/data/d3/cc/ccStatusD03.json')
			).json()) as {
				data?: unknown[];
			};
			if (!body.data?.length) return 'chain control list is empty';
		}
	},
	{
		name: 'odot-road-reports',
		run: async () => {
			const key = process.env.ORDOT_CODE_PRIMARY;
			if (!key) return null;
			const body = (await (
				await get('https://api.odot.state.or.us/tripcheck/RW/Reports', {
					'Ocp-Apim-Subscription-Key': key
				})
			).json()) as { 'road-weather-reports'?: unknown };
			if (!Array.isArray(body['road-weather-reports'])) return 'unexpected answer';
		}
	},
	{
		name: 'nws',
		run: async () => {
			await get('https://api.weather.gov/points/47.6062,-122.3321', {
				Accept: 'application/geo+json'
			});
		}
	},
	{
		name: 'github-token',
		run: async () => {
			const token = process.env.GITHUB_ISSUES_TOKEN;
			if (!token) return null;
			const res = await get(
				`https://api.github.com/repos/${REPO_URL.replace('https://github.com/', '')}`,
				{
					authorization: `Bearer ${token}`,
					accept: 'application/vnd.github+json'
				}
			);
			// Fine-grained tokens always expire; GitHub says when in this header ("2026-12-01 00:00:00 UTC").
			const expires = res.headers.get('github-authentication-token-expiration');
			const at = expires ? Date.parse(expires.replace(' UTC', 'Z').replace(' ', 'T')) : NaN;
			githubTokenDays = Number.isNaN(at) ? null : Math.floor((at - Date.now()) / 86_400_000);
		}
	}
];

async function runCheck(check: Check) {
	const now = new Date().toISOString();
	const old = state.get(check.name);
	let problem: string | undefined;
	try {
		const result = await check.run();
		if (result === null) {
			state.set(check.name, {
				status: 'not-configured',
				checked_at: now,
				last_ok: null,
				failures_in_a_row: 0
			});
			return;
		}
		if (typeof result === 'string') problem = result;
	} catch (err) {
		const message = (err as Error).message;
		problem = /^answered \d+$/.test(message)
			? message
			: (err as Error).name === 'TimeoutError'
				? 'no answer within 10 seconds'
				: 'could not connect';
	}
	state.set(check.name, {
		status: problem ? 'failing' : 'ok',
		checked_at: now,
		last_ok: problem ? (old?.last_ok ?? null) : now,
		failures_in_a_row: problem ? (old?.failures_in_a_row ?? 0) + 1 : 0,
		...(problem ? { problem } : {})
	});
	if (problem) console.warn(`[health] ${check.name}: ${problem}`);
}

/** Run every check now (and retry failures once after 20 seconds, so a single blip is told apart from an outage). */
export async function checkAll(retryAfterMs = 20_000) {
	await Promise.all(CHECKS.map(runCheck));
	const failing = CHECKS.filter((c) => state.get(c.name)?.status === 'failing');
	if (failing.length) {
		await new Promise((r) => setTimeout(r, retryAfterMs));
		await Promise.all(failing.map(runCheck));
	}
}

let started = false;
/** Check shortly after the server starts, then every half hour. */
export function startHealthChecks() {
	if (started) return;
	started = true;
	setTimeout(() => void checkAll(), 5_000);
	setInterval(() => void checkAll(), EVERY_MS).unref();
}

/** The latest results, for /healthz. */
export function healthReport() {
	return {
		sources: Object.fromEntries(
			CHECKS.map((c) => [
				c.name,
				state.get(c.name) ?? {
					status: 'unknown' as SourceStatus,
					checked_at: null,
					last_ok: null,
					failures_in_a_row: 0
				}
			])
		),
		github_token_expires_in_days: githubTokenDays
	};
}
