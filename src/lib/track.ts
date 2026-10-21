/**
 * Count a tap on the site's own visit counter (/stats). Sends only the name of what was tapped: no address typed,
 * no place, nothing about the person. Fire and forget; never blocks or breaks the page.
 */
export function track(name: string) {
	try {
		// Sent as JSON: other sites cannot send that to us without our permission, unlike a plain form post.
		navigator.sendBeacon?.(
			'/api/event',
			new Blob([JSON.stringify({ name })], { type: 'application/json' })
		);
	} catch {
		// counting is never worth an error
	}
}

/**
 * Count this page view (/api/view): the page's address and the page or site it came from. Sent from the page once
 * it runs, so programs that only download pages are not counted. Fire and forget.
 */
export function trackView(url: URL, referrer: string | null, first: boolean) {
	try {
		navigator.sendBeacon?.(
			'/api/view',
			new Blob([JSON.stringify({ path: url.pathname + url.search, referrer, first })], {
				type: 'application/json'
			})
		);
	} catch {
		// counting is never worth an error
	}
}
