<script lang="ts">
	import { postText, snowWords, type SnowingSpot } from '../../lib/snowing';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const KIND = { pass: 'Pass', ski: 'Ski area', park: 'Park' } as const;
	let copied = $state('');

	async function copy(s: SnowingSpot) {
		try {
			await navigator.clipboard.writeText(postText(s, data.origin));
			copied = s.id;
			setTimeout(() => (copied = ''), 2000);
		} catch {
			// no clipboard: the text is on the page to select
		}
	}
</script>

<svelte:head
	><title>Where It's Snowing Now: Passes and Ski Areas · What's Up Ahead</title></svelte:head
>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">Where it's snowing</span>
</header>

<main>
	<h1>Where it's snowing</h1>
	<p class="lede-dark">
		Mountain passes, ski areas and parks with new snow, snowing now first. Each has its cameras one
		tap away.
	</p>

	{#await data.spots}
		<p class="loading">Reading the snow gauges…</p>
	{:then spots}
		{#if spots === null}
			<p class="error">The snow gauges aren't answering just now. Try again in a few minutes.</p>
		{:else if !spots.length}
			<p class="empty">No new snow at any pass, ski area or park right now.</p>
		{:else}
			<ol class="powder-list">
				{#each spots as s (s.id)}
					{@const words = snowWords(s)}
					<li class="card powder-spot">
						<div class="powder-head">
							<a class="powder-name" href={s.href}>{s.name}</a>
							<span class="powder-drive">{s.now ? 'Snowing now' : 'New snow'}</span>
						</div>
						<span class="sub">{KIND[s.kind]}{s.state ? ` · ${s.state}` : ''}</span>
						{#if words}<span
								>{words}{#if s.gaugeLink}{' '}
									(<a href={s.gaugeLink} target="_blank" rel="noopener">{s.gauge}</a>){/if}</span
							>{/if}
						{#if s.reported}<span>{s.reported.by}: {s.reported.text}</span>{/if}
						<p class="snowing-post">{postText(s, data.origin)}</p>
						<button class="secondary snowing-copy" onclick={() => copy(s)}
							>{copied === s.id ? 'Copied' : 'Copy comment'}</button
						>
					</li>
				{/each}
			</ol>
		{/if}
		<p class="sub">
			Snow from the USDA SNOTEL gauges: for a pass, the gauge nearest the road's height; for a ski
			area or park, the highest gauge near it. A gauge's snow counts only when the water in the snow
			rose too, so a sensor's wobble isn't called snow. "Snowing now" means the gauge rose in the
			last 3 hours or the state's pass report says snow. Each gauge's name opens USDA's own hourly
			readings. Checked every half hour.
		</p>
	{/await}
</main>
