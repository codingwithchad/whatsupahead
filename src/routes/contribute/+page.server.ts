import { fail } from '@sveltejs/kit';
import { REPO_URL } from '../../lib/brand';
import { allow, visitorAddress } from '../../lib/server/rateLimit';
import { cleanField as clean, isWebAddress, suggestionIssue } from '../../lib/server/suggestion';
import { checkYoutube } from '../../lib/server/youtubeCheck';
import type { Actions } from './$types';

const DAY = 24 * 60 * 60_000;
const DAILY_LIMIT = 30;

/** The public repository the suggestions go to, taken from the project's own address. */
const repo = REPO_URL.replace('https://github.com/', '');

export const actions: Actions = {
	suggest: async ({ request, getClientAddress, fetch }) => {
		const form = await request.formData();
		// A hidden field real visitors never fill in; bots usually do.
		if (clean(form.get('website'), 100)) return { sent: true };

		const link = clean(form.get('link'), 400);
		const where = clean(form.get('where'), 200);
		const owner = clean(form.get('owner'), 200);
		const terms = clean(form.get('terms'), 800, true);
		const name = clean(form.get('name'), 60);
		const values = { link, where, owner, terms, name };

		const who = visitorAddress(request, getClientAddress);
		if (!allow(`contribute:${who}`, 5, 60 * 60_000))
			return fail(429, {
				error: 'That is a lot of suggestions at once. Please try again later.',
				values
			});

		if (!isWebAddress(link))
			return fail(400, {
				error: 'Please paste the web address of the camera or its page.',
				values
			});
		if (!where) return fail(400, { error: 'Tell us where the camera is.', values });

		const token = process.env.GITHUB_ISSUES_TOKEN;
		if (!token)
			return fail(503, {
				error: 'Suggestions are not switched on yet. Please check back soon.',
				values
			});

		// However many visitors there are, never file more than this many issues a day (stops a flood of spam).
		if (!allow('contribute:all', DAILY_LIMIT, DAY))
			return fail(429, {
				error: 'We have had a lot of suggestions today. Please try again tomorrow.',
				values
			});

		const issue = suggestionIssue(values, await checkYoutube(link));

		try {
			const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${token}`,
					accept: 'application/vnd.github+json',
					'content-type': 'application/json',
					'user-agent': 'WhatsUpAhead'
				},
				body: JSON.stringify({ ...issue, labels: ['data'] }),
				signal: AbortSignal.timeout(10000)
			});
			if (!res.ok) throw new Error(`github ${res.status}`);
		} catch (err) {
			console.warn(`[contribute] could not file the suggestion (${(err as Error).message})`);
			return fail(502, {
				error: 'Sorry, that did not go through. Please try again in a bit.',
				values
			});
		}
		return { sent: true };
	}
};
