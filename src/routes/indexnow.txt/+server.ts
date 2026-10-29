import { error } from '@sveltejs/kit';
import { indexNowKey } from '../../lib/server/indexNow';
import type { RequestHandler } from './$types';

/** IndexNow's proof that the site is ours: the key, readable on the site itself (see indexNow.ts). */
export const GET: RequestHandler = () => {
	const host = process.env.CANONICAL_HOST?.trim().toLowerCase();
	if (!host) error(404, 'Not found');
	return new Response(indexNowKey(host), { headers: { 'content-type': 'text/plain' } });
};
