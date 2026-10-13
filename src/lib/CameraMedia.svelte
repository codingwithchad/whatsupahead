<script lang="ts">
	import { track } from './track';
	import { ago } from './format';
	import type { Camera } from './types';

	// The picture or live player for one camera, kept fresh. Used by the camera cards and by the full-screen viewer.
	// `onopen` makes a still picture tappable (to open the viewer); `large` shows it as big as the screen allows.
	let {
		camera,
		onopen,
		large = false
	}: { camera: Camera; onopen?: () => void; large?: boolean } = $props();

	const refreshMs = $derived((camera.refresh_seconds ?? 120) * 1000);
	const isImage = $derived(camera.feed_type === 'image');
	const view = $derived(camera.view);
	let tick = $state(Date.now());
	let modified = $state<string | null>(null);
	let providerUrl = $state<string | null>(null);
	let watching = $state(false);
	// A picture that fails to load gets one retry, then a clear "unavailable" tile until the next refresh.
	let retry = $state(0);
	let failed = $state(false);

	function onFail() {
		if (retry < 1 && !view) setTimeout(() => retry++, 1500);
		else failed = true;
	}
	function onOk() {
		failed = false;
	}

	// Which picture to ask the owner for. It changes only when the owner has a new picture (or, when we can't
	// tell, once per refresh), so an open page doesn't download the same picture again and again: the camera
	// owners' servers carry every visitor (WSDOT asked us to be kind to them).
	let version = $state(Math.floor(Date.now() / 120_000));

	async function loadAge() {
		if (!isImage) return;
		let next: string | null = null;
		try {
			const res = await fetch(`/api/cameras/${encodeURIComponent(camera.id)}/age`);
			if (res.ok) {
				const body = await res.json();
				next = body.modified;
				providerUrl = body.url;
			}
		} catch {
			// age is a nice-to-have; ignore failures
		}
		// The first answer describes the picture already shown; after that, a new time means a new picture.
		if (next && modified && next !== modified) version = Date.parse(next);
		else if (!next && modified === null) version = Math.floor(Date.now() / refreshMs);
		modified = next ?? modified;
	}

	$effect(() => {
		if (!isImage) return;
		loadAge();
		const refresh = () => {
			tick = Date.now();
			retry = 0;
			failed = false;
			loadAge();
		};
		// Nothing is fetched while the page is out of sight (another tab, the phone locked); it catches up on return.
		const timer = setInterval(() => {
			if (!document.hidden) refresh();
		}, refreshMs);
		const onShow = () => {
			if (!document.hidden && Date.now() - tick >= refreshMs) refresh();
		};
		document.addEventListener('visibilitychange', onShow);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onShow);
		};
	});

	// Provider pictures must be used exactly as the provider gave them, so no cache-busting parameter.
	const imageSrc = $derived(
		view
			? (providerUrl ?? camera.feed_url)
			: camera.max_width || camera.mirror
				? `/img/${encodeURIComponent(camera.id)}?t=${version}&r=${retry}`
				: `${camera.feed_url}${camera.feed_url?.includes('?') ? '&' : '?'}t=${version}&r=${retry}`
	);
	const shownModified = $derived(modified ?? view?.modified ?? null);
	const age = $derived(shownModified ? ago(shownModified, tick) : null);
	const stale = $derived(
		shownModified ? tick - new Date(shownModified).getTime() > refreshMs * 5 : false
	);
</script>

{#snippet picture(lazy: boolean)}
	{#if failed}
		<span class="cam-down">Camera unavailable right now</span>
	{:else}
		<img
			src={imageSrc}
			alt={camera.name}
			loading={lazy ? 'lazy' : 'eager'}
			width={view?.width}
			onerror={onFail}
			onload={onOk}
		/>
	{/if}
	{#if age}<span class="age" class:stale>{stale ? 'Stale · ' : ''}{age}</span>{/if}
{/snippet}

{#if view && onopen}
	<!-- On a card, every camera opens the viewer the same way. Windy pictures stay at their own size (Windy's
	     terms), and the card carries the link to Windy's full view. -->
	<button class="image-button windy" onclick={onopen} aria-label="View {camera.name}">
		{@render picture(true)}
	</button>
{:else if view}
	<!-- In the viewer, Windy pictures are never enlarged and link back to Windy for the full view. -->
	<a
		class="image-link"
		href={view.link}
		target="_blank"
		rel="noopener"
		aria-label="Open {camera.name} on Windy.com"
	>
		{@render picture(!large)}
	</a>
{:else if isImage && onopen}
	<button class="image-button" onclick={onopen} aria-label="View {camera.name} full screen">
		{@render picture(true)}
	</button>
{:else if isImage}
	<div class="image-button" class:large>{@render picture(false)}</div>
{:else if camera.embed_mode === 'iframe'}
	<!-- A live YouTube video loads only after a tap, so nothing from YouTube runs until someone asks for it. -->
	{#if watching}
		<iframe
			class="live-embed"
			src="{camera.feed_url}{camera.feed_url?.includes('?') ? '&' : '?'}autoplay=1&mute=1&rel=0"
			title={camera.name}
			allow="autoplay; picture-in-picture; fullscreen"
			referrerpolicy="strict-origin-when-cross-origin"
			allowfullscreen
		></iframe>
	{:else}
		<button
			class="live-play"
			onclick={() => {
				watching = true;
				track('watch-live');
			}}
		>
			<span class="live-badge"><i></i> Live</span>
			<span class="play-icon" aria-hidden="true"></span>
			Watch live
			<small>Plays from YouTube</small>
		</button>
	{/if}
{:else}
	<video src={camera.feed_url} controls muted playsinline preload="none"></video>
{/if}
