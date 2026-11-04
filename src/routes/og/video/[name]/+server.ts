import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { videoFile } from '../../../../lib/server/storyVideo';
import type { RequestHandler } from './$types';

/** A story's video, for Instagram to fetch once. Only names we made; there is no way to ask for a new one. */
export const GET: RequestHandler = async ({ params }) => {
	const file = videoFile(params.name);
	if (!file) error(404, 'No such video');
	const body = await readFile(file).catch(() => null);
	if (!body) error(404, 'No such video');
	return new Response(new Uint8Array(body), {
		headers: { 'content-type': 'video/mp4', 'cache-control': 'no-store' }
	});
};
