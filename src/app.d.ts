// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/** Set at build time (vite.config.ts): the commit and when it was built. */
	const __BUILD__: { commit: string; built: string };
	namespace App {
		// interface Error {}
		interface Locals {
			/** Set by the search page when a typed search found (true) or did not find (false) a place. */
			searchFound?: boolean;
		}
		interface PageData {
			/** What a shared link to this page shows (see src/lib/sharing.ts). */
			share?: import('./lib/sharing').ShareMeta;
		}
		interface PageState {
			/** Which camera the full-screen viewer shows (its place in the list), when it is open. */
			camera?: number;
		}
		// interface Platform {}
	}
}

export {};
