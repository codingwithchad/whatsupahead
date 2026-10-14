<script lang="ts">
	import { track } from './track';
	import { pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import CameraCard from './CameraCard.svelte';
	import CameraViewer from './CameraViewer.svelte';
	import type { Camera, Nearby } from './types';

	// A grid of camera cards. Tapping a picture opens the full-screen viewer at that camera.
	// The open camera lives in the browser history, so the phone's Back button closes the viewer.
	// `ondead` hears which cameras have no picture or only a very old one (see CameraMedia).
	let {
		items,
		ondead
	}: {
		items: { camera: Nearby<Camera>; note?: string }[];
		ondead?: (id: string, dead: boolean) => void;
	} = $props();

	const index = $derived(page.state.camera ?? -1);
</script>

<div class="grid">
	{#each items as item, i (item.camera.id)}
		<CameraCard
			camera={item.camera}
			note={item.note}
			ondead={ondead && ((dead) => ondead(item.camera.id, dead))}
			onopen={() => {
				track('viewer-open');
				pushState('', { camera: i });
			}}
		/>
	{/each}
</div>

<CameraViewer
	{items}
	{index}
	onnavigate={(i) => replaceState('', { camera: i })}
	onclose={() => history.back()}
/>
