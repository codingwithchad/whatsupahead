import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { execSync } from 'node:child_process';

// Which code is running, for /healthz: the commit this was built from (from the host if it says, else git).
function commit(): string {
	if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT.slice(0, 7);
	try {
		const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
		const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
		return dirty ? `${sha}-modified` : sha;
	} catch {
		return 'unknown';
	}
}

export default defineConfig({
	define: {
		__BUILD__: JSON.stringify({ commit: commit(), built: new Date().toISOString() })
	},
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// Content Security Policy: only this site's own scripts run (SvelteKit adds a one-time nonce to its own
			// inline scripts). Camera pictures come from many owners' servers, so any https picture is allowed;
			// the only embedded players are YouTube's.
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					// Svelte marks pictures with onload/onerror="this.__e=event" so a broken picture is caught before the
					// page wakes up; allow exactly that one snippet by its hash, and no other inline handler.
					'script-src': [
						'self',
						'unsafe-hashes',
						'sha256-7dQwUgLau1NFCCGjfn9FsYptB6ZtWxJin6VohGIu20I='
					],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'https:', 'data:', 'blob:'],
					'media-src': ['self', 'https:'],
					'frame-src': ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
					'connect-src': ['self'],
					'font-src': ['self'],
					'worker-src': ['self'],
					'manifest-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self'],
					'frame-ancestors': ['self']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
