import { describe, expect, it } from 'vitest';
import { allow, isCloudflare, visitorAddress, withoutPort } from './rateLimit';

describe('allow', () => {
	it('lets calls through up to the limit, then says no', () => {
		const key = 'test-a';
		const results = Array.from({ length: 5 }, () => allow(key, 3, 1000, 0));
		expect(results).toEqual([true, true, true, false, false]);
	});

	it('lets calls through again after the window passes', () => {
		const key = 'test-b';
		for (let i = 0; i < 3; i++) allow(key, 3, 1000, 0);
		expect(allow(key, 3, 1000, 500)).toBe(false);
		expect(allow(key, 3, 1000, 1500)).toBe(true);
	});

	it('counts each visitor separately', () => {
		allow('test-c', 1, 1000, 0);
		expect(allow('test-c', 1, 1000, 1)).toBe(false);
		expect(allow('test-d', 1, 1000, 1)).toBe(true);
	});
});

describe('visitorAddress', () => {
	const req = (xff?: string) =>
		new Request('http://x/', { headers: xff ? { 'x-forwarded-for': xff } : {} });
	const socket = () => '10.0.0.1';

	it('uses the entry the proxy added, not one the visitor made up', () => {
		// Render's proxies add three entries: the visitor, then two of their own.
		expect(visitorAddress(req('203.0.113.9, 10.1.1.1, 10.2.2.2'), socket)).toBe('203.0.113.9');
		expect(visitorAddress(req('6.6.6.6, 203.0.113.9, 10.1.1.1, 10.2.2.2'), socket)).toBe(
			'203.0.113.9'
		);
	});

	it("trusts Cloudflare's CF-Connecting-IP only when the request came from Cloudflare", () => {
		const through = (peer: string, visitor: string) =>
			new Request('http://x/', {
				headers: { 'x-forwarded-for': `6.6.6.6, ${peer}`, 'cf-connecting-ip': visitor }
			});
		const old = process.env.TRUSTED_PROXIES;
		process.env.TRUSTED_PROXIES = '1';
		try {
			expect(visitorAddress(through('172.70.1.2:443', '203.0.113.9'), socket)).toBe('203.0.113.9');
			expect(visitorAddress(through('[2606:4700::1]:443', '2001:db8::5'), socket)).toBe(
				'2001:db8::5'
			);
			// Someone reaching the app directly can't choose who they are.
			expect(visitorAddress(through('198.51.100.7:5555', '203.0.113.9'), socket)).toBe(
				'198.51.100.7'
			);
			expect(visitorAddress(through('172.70.1.2:443', 'not an address'), socket)).toBe(
				'172.70.1.2'
			);
		} finally {
			process.env.TRUSTED_PROXIES = old;
		}
	});

	it('knows Cloudflare addresses', () => {
		expect(isCloudflare('104.16.1.1')).toBe(true);
		expect(isCloudflare('2a06:98c1::1')).toBe(true);
		expect(isCloudflare('203.0.113.9')).toBe(false);
		expect(isCloudflare('nonsense')).toBe(false);
	});

	it('uses the connection address when there is no proxy header', () => {
		expect(visitorAddress(req(), socket)).toBe('10.0.0.1');
	});

	it('keeps a long window when other keys are cleaned up', () => {
		allow('test-day', 1, 24 * 60 * 60_000, 0);
		for (let i = 0; i < 5001; i++) allow(`test-flood-${i}`, 1, 1000, 0);
		allow('test-trigger', 1, 1000, 10_000);
		expect(allow('test-day', 1, 24 * 60 * 60_000, 10_000)).toBe(false);
	});
});

describe('withoutPort', () => {
	it('drops the port Azure adds, and leaves plain addresses alone', () => {
		expect(withoutPort('203.0.113.5:51234')).toBe('203.0.113.5');
		expect(withoutPort('[2001:db8::1]:51234')).toBe('2001:db8::1');
		expect(withoutPort('203.0.113.5')).toBe('203.0.113.5');
		expect(withoutPort('2001:db8::1')).toBe('2001:db8::1');
	});
});
