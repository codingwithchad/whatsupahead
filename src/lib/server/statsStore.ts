import { readFileSync, renameSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Where the visit counts live. On Azure: one small JSON blob, written by the app's own identity (no keys or
// passwords), with old versions kept for a while by the storage account. Elsewhere (a laptop): a local file.
// Both answer "here is the document and its version tag", and only accept a write made against the version
// that was read, so two copies of the app (during a deploy) can't overwrite each other's counts.

export interface Stored<T> {
	doc: T | null;
	/** The version that was read; a write must name it. Null when there is nothing stored yet. */
	etag: string | null;
}

export interface StatsStore<T> {
	name: string;
	read(): Promise<Stored<T>>;
	/** Returns false when someone else wrote first: read again, add your changes, try again. */
	write(doc: T, etag: string | null): Promise<boolean>;
}

export function fileStore<T>(file: string): StatsStore<T> {
	const version = () => {
		try {
			return String(statSync(file).mtimeMs);
		} catch {
			return null;
		}
	};
	return {
		name: `file ${file}`,
		async read() {
			const etag = version();
			if (!etag) return { doc: null, etag: null };
			return { doc: JSON.parse(readFileSync(file, 'utf8')) as T, etag };
		},
		async write(doc, etag) {
			if (version() !== etag) return false;
			mkdirSync(path.dirname(file), { recursive: true });
			writeFileSync(`${file}.tmp`, JSON.stringify(doc));
			renameSync(`${file}.tmp`, file);
			return true;
		}
	};
}

let token: { value: string; until: number } | null = null;

/** A token for Azure Storage from the app's managed identity (App Service provides the endpoint). */
async function storageToken(): Promise<string> {
	if (token && Date.now() < token.until) return token.value;
	const endpoint = process.env.IDENTITY_ENDPOINT;
	const secret = process.env.IDENTITY_HEADER;
	if (!endpoint || !secret) throw new Error('no managed identity here');
	const url = `${endpoint}?resource=${encodeURIComponent('https://storage.azure.com/')}&api-version=2019-08-01`;
	const res = await fetch(url, {
		headers: { 'X-IDENTITY-HEADER': secret },
		signal: AbortSignal.timeout(5000)
	});
	if (!res.ok) throw new Error(`identity ${res.status}`);
	const body = (await res.json()) as { access_token: string; expires_on: string };
	// Renew five minutes early.
	token = { value: body.access_token, until: Number(body.expires_on) * 1000 - 5 * 60_000 };
	return token.value;
}

export function blobStore<T>(url: string): StatsStore<T> {
	const headers = async () => ({
		authorization: `Bearer ${await storageToken()}`,
		'x-ms-version': '2023-11-03'
	});
	return {
		name: `blob ${new URL(url).host}`,
		async read() {
			const res = await fetch(url, { headers: await headers(), signal: AbortSignal.timeout(8000) });
			if (res.status === 404) return { doc: null, etag: null };
			if (!res.ok) throw new Error(`blob read ${res.status}`);
			return { doc: (await res.json()) as T, etag: res.headers.get('etag') };
		},
		async write(doc, etag) {
			const res = await fetch(url, {
				method: 'PUT',
				headers: {
					...(await headers()),
					'x-ms-blob-type': 'BlockBlob',
					'content-type': 'application/json',
					// Only if nobody wrote since we read (or, for the first write, only if it still doesn't exist).
					...(etag ? { 'if-match': etag } : { 'if-none-match': '*' })
				},
				body: JSON.stringify(doc),
				signal: AbortSignal.timeout(8000)
			});
			if (res.status === 412 || res.status === 409) return false;
			if (!res.ok) throw new Error(`blob write ${res.status}`);
			return true;
		}
	};
}
