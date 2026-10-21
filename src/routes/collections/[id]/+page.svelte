<script lang="ts">
	import { loadOpenStates, saveOpenState } from '../../../lib/openStates';
	import ListControls from '../../../lib/ListControls.svelte';
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
	// Ski areas: sort by the most new snow (the default November to April); Show narrows the list to one state or
	// mountain area, in the address.
	const month = new Date().getMonth();
	let sort = $state(month >= 10 || month <= 3 ? 'snow' : 'state');
	let snow = $state<Record<string, SkiSnow> | null>(null);
	$effect(() => {
		void data.snow?.then((s) => (snow = s));
	});
	/** New snow first: the last 24 hours, then since 6 AM, then what's still to fall today. */
	// Changes under 2 inches are a gauge wobbling, not snow (as on the cards).
	const score = (s: SkiSnow | undefined) =>
		s
			? ((s.change24 ?? 0) >= 2 ? s.change24! : 0) * 1000 +
				((s.sinceSix ?? 0) >= 1 && (s.depthIn ?? 0) >= 2 ? s.sinceSix! : 0) * 10 +
				(s.forecastIn ?? 0)
			: -1;
	const bySnow = $derived(
		data.groups
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

<svelte:head><title>{data.title} · What's Up Ahead</title></svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">{data.collection.name}</span>
</header>

<main>
	<h1>{data.title}</h1>
	{#if data.collection.blurb && !data.area}<p class="lede-dark">{data.collection.blurb}</p>{/if}
	<div class="page-actions">
		<ShareButton path={data.path} title={data.title} text="{data.title}: cameras and weather" />
	</div>
	{#if data.snow}
		<p class="powder-link">
			<a href="/powder">Powder day: the most new snow within a few hours' drive of you →</a>
		</p>
		<ListControls
			sorts={[
				{ id: 'snow', label: 'Most new snow' },
				{ id: 'state', label: 'By state' }
			]}
			bind:sort
			storageKey="ski-sort"
			areas={data.areas}
			area={data.area}
			base="/collections/{data.collection.id}"
		/>
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
		{#each data.groups as group (group.state)}
			<details
				class="tree-region state-fold"
				class:single={!folds || data.area !== null}
				open={data.area !== null || isOpen(group.state)}
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
