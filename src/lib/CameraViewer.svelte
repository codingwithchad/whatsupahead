<script lang="ts">
	import { track } from './track';
	import CameraMedia from './CameraMedia.svelte';
	import HistoryPlayer from './HistoryPlayer.svelte';
	import ShareButton from './ShareButton.svelte';
	import type { Camera, Nearby } from './types';

	// One camera at a time, as big as the screen allows, with Previous and Next (buttons, swipe or arrow keys)
	// so a passenger can flip through every camera on a drive without scrolling. `index` -1 means closed.
	let {
		items,
		index,
		onnavigate,
		onclose
	}: {
		items: { camera: Nearby<Camera>; note?: string }[];
		index: number;
		onnavigate: (index: number) => void;
		onclose: () => void;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	const item = $derived(index >= 0 ? items[Math.min(index, items.length - 1)] : undefined);
	const hasPrev = $derived(index > 0);
	const hasNext = $derived(index >= 0 && index < items.length - 1);

	$effect(() => {
		if (!dialog) return;
		if (item && !dialog.open) dialog.showModal();
		if (!item && dialog.open) dialog.close();
		// Keep the page behind from scrolling while the viewer is open.
		document.documentElement.style.overflow = item ? 'hidden' : '';
	});

	const go = (step: number, how: 'viewer-next' | 'viewer-swipe' = 'viewer-next') => {
		const to = index + step;
		if (to < 0 || to >= items.length) return;
		track(how);
		onnavigate(to);
	};

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') go(1);
		else if (e.key === 'ArrowLeft') go(-1);
	}

	// Swipe left for the next camera, right for the previous one.
	let startX = 0;
	let startY = 0;
	function onpointerdown(e: PointerEvent) {
		startX = e.clientX;
		startY = e.clientY;
	}
	function onpointerup(e: PointerEvent) {
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1, 'viewer-swipe');
	}
</script>

<dialog
	bind:this={dialog}
	class="viewer"
	aria-label="Camera viewer"
	{onkeydown}
	onclose={() => {
		// Closed by the Escape key: tell the page. (When the page closed it, index is already -1.)
		if (index >= 0) onclose();
	}}
>
	{#if item}
		<header class="viewer-top">
			<span class="viewer-count">{index + 1} of {items.length}</span>
			<button class="viewer-close" onclick={onclose} aria-label="Close">✕</button>
		</header>
		<div
			class="viewer-stage"
			role="group"
			aria-label="Swipe for the next or previous camera"
			{onpointerdown}
			{onpointerup}
		>
			{#key item.camera.id}<CameraMedia camera={item.camera} large />{/key}
		</div>
		<div class="viewer-info">
			<h2>{item.camera.name}</h2>
			<p class="sub">
				{item.note ?? `${item.camera.distance.toFixed(1)} mi`}{item.camera.location_precision ===
				'approximate'
					? ' (approx.)'
					: ''}
				· {item.camera.attribution_text ?? item.camera.source}
				{#if item.camera.view}
					· <a href={item.camera.view.link} target="_blank" rel="noopener">Full size on Windy ↗</a>
				{:else if item.camera.page_url}
					· <a href={item.camera.page_url} target="_blank" rel="noopener">Source page</a>
				{/if}
			</p>
			{#if item.camera.feed_type === 'image' && !item.camera.view}
				{#key item.camera.id}<HistoryPlayer id={item.camera.id} name={item.camera.name} />{/key}
			{/if}
			{#key item.camera.id}<ShareButton
					dark
					path="/cameras/{item.camera.id}"
					title={item.camera.name}
					text="Camera: {item.camera.name}"
				/>{/key}
		</div>
		<nav class="viewer-nav" aria-label="Cameras">
			<button class="secondary" disabled={!hasPrev} onclick={() => go(-1)}>‹ Previous</button>
			<button disabled={!hasNext} onclick={() => go(1)}>Next ›</button>
		</nav>
	{/if}
</dialog>
