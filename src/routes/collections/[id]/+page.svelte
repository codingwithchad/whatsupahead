<script lang="ts">
	import { loadOpenStates, saveOpenState } from '../../../lib/openStates';
	import ShareButton from '../../../lib/ShareButton.svelte';
	import SkiSnowLine from '../../../lib/SkiSnowLine.svelte';
	import type { SkiSnow } from '../../../lib/server/skiSnow';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	// With more than one state, each folds (most people want one); the ones opened before open again.
	let opened = $state<Record<string, boolean>>({});
	$effect(() => {
		opened = loadOpenStates();
	});
	// Ski areas: sort by the most new snow (the default November to April) and pick a state.
	const SORT_KEY = 'ski-sort';
	const month = new Date().getMonth();
	let sort = $state<'snow' | 'state'>(month >= 10 || month <= 3 ? 'snow' : 'state');
	let only = $state<string | null>(null);
	let snow = $state<Record<string, SkiSnow> | null>(null);
	$effect(() => {
		try {
			const saved = localStorage.getItem(SORT_KEY);
			if (saved === 'snow' || saved === 'state') sort = saved;
		} catch {
			// remembering is optional
		}
		void data.snow?.then((s) => (snow = s));
	});
	function setSort(to: 'snow' | 'state') {
		sort = to;
		try {
			localStorage.setItem(SORT_KEY, to);
		} catch {
			// remembering is optional
		}
	}
	/** New snow first: the last 24 hours, then since 6 AM, then what's still to fall today. */
	// Changes under 2 inches are a gauge wobbling, not snow (as on the cards).
	const score = (s: SkiSnow | undefined) =>
		s
			? ((s.change24 ?? 0) >= 2 ? s.change24! : 0) * 1000 +
				((s.sinceSix ?? 0) >= 1 && (s.depthIn ?? 0) >= 2 ? s.sinceSix! : 0) * 10 +
				(s.forecastIn ?? 0)
			: -1;
	const shownGroups = $derived(data.groups.filter((g) => !only || g.state === only));
	const bySnow = $derived(
		shownGroups
			.flatMap((g) => g.places)
			// Heavenly is under two states: once in the list.
			.filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i)
			.sort((a, b) => score(snow?.[b.id]) - score(snow?.[a.id]))
	);
	const folds = $derived(data.groups.length > 1);
	const isOpen = (name: string) => !folds || (opened[name] ?? false);
	const toggled = (name: string) => (e: Event) => {
		const open = (e.currentTarget as HTMLDetailsElement).open;
		if (folds && open !== isOpen(name)) {
			opened[name] = open;
			saveOpenState(name, open);
		}
	};
</script>

<svelte:head><title>{data.collection.name} · What's Up Ahead</title></svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">{data.collection.name}</span>
</header>

<main>
	<h1>{data.collection.name}</h1>
	{#if data.collection.blurb}<p class="lede-dark">{data.collection.blurb}</p>{/if}
	<div class="page-actions">
		<ShareButton
			path="/collections/{data.collection.id}"
			title={data.collection.name}
			text="{data.collection.name}: cameras and weather"
		/>
	</div>
	{#if data.snow}
		<div class="ski-controls">
			<div class="chips" role="group" aria-label="Sort">
				<button class="chip" aria-pressed={sort === 'snow'} onclick={() => setSort('snow')}
					>Most new snow</button
				>
				<button class="chip" aria-pressed={sort === 'state'} onclick={() => setSort('state')}
					>By state</button
				>
			</div>
			<div class="chips" role="group" aria-label="State">
				<button class="chip" aria-pressed={only === null} onclick={() => (only = null)}>All</button>
				{#each data.groups as g (g.state)}
					<button class="chip" aria-pressed={only === g.state} onclick={() => (only = g.state)}
						>{g.state}</button
					>
				{/each}
			</div>
		</div>
	{/if}

	{#snippet card(place: (typeof data.groups)[number]['places'][number])}
		<a class="place" href="/search?place={encodeURIComponent(place.id)}">
			<span class="cover">
				{#if place.cover}<img src={place.cover.url} alt="" loading="lazy" />{/if}
			</span>
			<span class="place-body">
				<span class="place-name">{place.name}</span>
				{#if place.blurb}<span class="place-sub">{place.blurb}</span>{/if}
				{#if data.snow}
					{#if snow === null}
						<span class="glance glance-loading">Checking the snow…</span>
					{:else if snow[place.id]}
						<SkiSnowLine snow={snow[place.id]} />
					{/if}
				{/if}
				{#if data.glances}
					{#await data.glances}
						<span class="glance glance-loading">Checking the line…</span>
					{:then glances}
						{#if glances[place.id]}
							<span class="glance glance-{glances[place.id].tone}">{glances[place.id].text}</span>
						{/if}
					{/await}
				{/if}
				<span class="place-count">{place.liveCameras} cameras</span>
			</span>
		</a>
	{/snippet}

	{#if data.snow && sort === 'snow'}
		<p class="sub">
			Most new snow in the last 24 hours first, from the nearest USDA snow gauge, then today's
			forecast (Open-Meteo). Resorts' own reports may differ.
		</p>
		<nav class="places grid-places" aria-label="{data.collection.name}, most new snow first">
			{#each bySnow as place (place.id)}{@render card(place)}{/each}
		</nav>
	{:else}
		{#each shownGroups as group (group.state)}
			<details
				class="tree-region state-fold"
				class:single={!folds || only !== null}
				open={only !== null || isOpen(group.state)}
				ontoggle={toggled(group.state)}
			>
				<summary>
					<span class="tree-name">{group.state}</span>
					<span class="tree-count"
						>{group.places.length} {group.places.length === 1 ? 'place' : 'places'}</span
					>
				</summary>
				<nav class="places grid-places" aria-label="{data.collection.name}: {group.state}">
					{#each group.places as place (place.id)}{@render card(place)}
					{/each}
				</nav>
			</details>
		{/each}
	{/if}
</main>
