<script lang="ts">
	import { track } from './track';
	import { goto } from '$app/navigation';
	import SearchBox from './SearchBox.svelte';
	import TripForm from './TripForm.svelte';
	import type { Drive } from './types';

	let {
		chips = [],
		drives = [],
		searches = [],
		trips = []
	}: {
		chips?: { id: string; name: string }[];
		drives?: Drive[];
		searches?: { q: string; label: string }[];
		trips?: { from: string; to: string }[];
	} = $props();

	const MODE_KEY = 'oscams:mode';
	let mode = $state<'place' | 'drive'>('place');
	let locating = $state(false);
	let error = $state('');

	$effect(() => {
		try {
			if (localStorage.getItem(MODE_KEY) === 'drive') mode = 'drive';
		} catch {
			// remembering the last choice is optional
		}
	});

	function pick(next: 'place' | 'drive') {
		mode = next;
		try {
			localStorage.setItem(MODE_KEY, next);
		} catch {
			// optional
		}
	}

	function useMyLocation() {
		error = '';
		if (!navigator.geolocation) {
			error = 'Location is not available on this device.';
			return;
		}
		locating = true;
		track('use-location');
		navigator.geolocation.getCurrentPosition(
			(pos) =>
				goto(`/search?q=${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`),
			() => {
				locating = false;
				error = 'Could not get your location.';
			},
			{ timeout: 10000 }
		);
	}

	const driveLink = (d: Drive) =>
		`/trip?from=${encodeURIComponent(d.from)}&to=${encodeURIComponent(d.to)}${d.from_label ? `&fl=${encodeURIComponent(d.from_label)}` : ''}${d.to_label ? `&tl=${encodeURIComponent(d.to_label)}` : ''}`;
</script>

<section class="start-card" aria-label="Start here">
	<div class="seg" role="tablist" aria-label="What do you want to see?">
		<button
			role="tab"
			aria-selected={mode === 'place'}
			class:on={mode === 'place'}
			onclick={() => pick('place')}
		>
			One place
		</button>
		<button
			role="tab"
			aria-selected={mode === 'drive'}
			class:on={mode === 'drive'}
			onclick={() => pick('drive')}
		>
			A drive
		</button>
	</div>

	{#if mode === 'place'}
		<p class="start-help">Every camera and report around one spot.</p>
		<SearchBox />
		{#if searches.length}
			<div class="chips recent-searches" aria-label="Recent searches">
				{#each searches as s (s.q)}
					<a class="chip" href="/search?q={encodeURIComponent(s.q)}">{s.label}</a>
				{/each}
			</div>
		{/if}
		<button class="secondary wide" onclick={useMyLocation} disabled={locating}>
			{locating ? 'Finding you…' : 'Use my location'}
		</button>
		{#if error}<p class="error">{error}</p>{/if}
	{:else}
		<p class="start-help">Pick a start and a finish. Cameras show in the order you'll pass them.</p>
		<TripForm places={chips} />
		{#if trips.length}
			<div class="chips recent-searches" aria-label="Recent drives">
				{#each trips as t (t.from + '|' + t.to)}
					<a
						class="chip"
						href="/trip?from={encodeURIComponent(t.from)}&to={encodeURIComponent(t.to)}"
						>{t.from} → {t.to}</a
					>
				{/each}
			</div>
		{/if}
		{#if drives.length}
			<h3 class="mini-title">Drives this season</h3>
			<nav class="drives" aria-label="Drives this season">
				{#each drives as d (d.id)}
					<a class="drive" href={driveLink(d)}>
						<span class="place-name">{d.name}</span>
						{#if d.blurb}<span class="place-sub">{d.blurb}</span>{/if}
					</a>
				{/each}
			</nav>
		{/if}
	{/if}
</section>
