<script lang="ts">
	import { page } from '$app/state';
	import { track } from './track';

	// Share this camera, place, list or drive. On phones this opens the phone's own share sheet (Facebook, Messages,
	// WhatsApp, whatever is installed); elsewhere a small menu with Copy link, Facebook, Text and Email. No
	// Facebook script is loaded on our pages: the Facebook choice is a plain link to Facebook's share page.
	let {
		path,
		title,
		text,
		dark = false,
		compact = false
	}: { path: string; title: string; text: string; dark?: boolean; compact?: boolean } = $props();

	const url = $derived(new URL(path, page.url.origin).href);
	const enc = encodeURIComponent;
	let open = $state(false);
	let copied = $state(false);

	async function share() {
		track('share');
		if (navigator.share) {
			try {
				await navigator.share({ title, text, url });
				track('share-sent');
				return;
			} catch (err) {
				// Closed the share sheet: nothing more to do.
				if ((err as DOMException).name === 'AbortError') return;
			}
		}
		open = !open;
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			track('share-copy');
			setTimeout(() => (copied = false), 2000);
		} catch {
			// no clipboard: the address is still in the browser's address bar
		}
	}
</script>

<div class="share" class:dark>
	<button
		class="secondary share-btn"
		onclick={share}
		aria-expanded={open}
		aria-label={compact ? 'Share' : undefined}
		title={compact ? 'Share' : undefined}
	>
		<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
			><path
				d="M12 3v12M7 8l5-5 5 5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/></svg
		>
		{#if !compact}Share{/if}
	</button>
	{#if open}
		<div class="share-menu" role="group" aria-label="Share">
			<button class="secondary" onclick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
			<a
				class="chip"
				href="https://www.facebook.com/sharer/sharer.php?u={enc(url)}"
				target="_blank"
				rel="noopener"
				onclick={() => track('share-facebook')}>Facebook</a
			>
			<a class="chip" href="sms:?&body={enc(`${text} ${url}`)}" onclick={() => track('share-text')}
				>Text message</a
			>
			<a class="chip" href="mailto:?subject={enc(title)}&body={enc(`${text}\n\n${url}`)}">Email</a>
		</div>
	{/if}
</div>
