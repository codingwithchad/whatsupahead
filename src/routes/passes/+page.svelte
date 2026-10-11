<script lang="ts">
	import StatusPill from '../../lib/StatusPill.svelte';
	import { ago } from '../../lib/format';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	// Passes without a report are counted on their own, never as open: no report is not an all-clear.
	const order = ['closed', 'chains', 'traction', 'open', 'off-season'] as const;
	const names: Record<(typeof order)[number], string> = {
		closed: 'closed',
		chains: 'chains',
		traction: 'traction advised',
		open: 'open',
		'off-season': 'no report yet'
	};
	const counts: Record<string, number> = $derived(data.counts);
	// The first sentence of WSDOT's note, for passes that are not reporting right now.
	const firstSentence = (s: string) => (s.match(/^.*?[.!](\s|$)/)?.[0] ?? s).trim().slice(0, 140);
</script>

<svelte:head><title>Mountain passes · What's Up Ahead</title></svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">Mountain passes</span>
</header>

<main>
	<h1>Mountain passes</h1>
	<p class="lede-dark">
		Open or closed, chains, and conditions for every Washington pass from WSDOT's pass reports, plus
		cameras and forecasts for Oregon's passes.
	</p>

	{#if data.reachable}
		<p class="pass-summary">
			{#each order.filter((o) => counts[o]) as o, i (o)}{i ? ' · ' : ''}<strong>{counts[o]}</strong>
				{names[o]}{/each}
		</p>
		{#if data.counts['off-season']}
			<p class="sub">
				WSDOT's winter reports usually run November to April. Until they start, there's no official
				report for those passes: check the cameras and the forecast.
			</p>
		{/if}
	{:else}
		<p class="place-note">
			Pass reports aren't loading right now. Each pass page still shows its cameras and forecast.
		</p>
	{/if}

	{#each data.groups as g (g.name)}
		<h2 class="section-title">{g.name}</h2>
		<ul class="pass-list">
			{#each g.passes as p (p.id)}
				<li>
					<a href="/search?place={encodeURIComponent(p.place)}">
						<span class="pass-top">
							<span class="place-name">{p.name}</span>
							{#if p.report}<StatusPill tone={p.report.status} label={p.report.label} />{/if}
						</span>
						<span class="place-sub"
							>{[
								p.route,
								p.elevation_ft ? `${p.elevation_ft.toLocaleString()} ft` : null,
								p.connects
							]
								.filter(Boolean)
								.join(' · ')}</span
						>
						{#if p.report && p.report.status !== 'off-season'}
							<span class="pass-detail">
								{[
									p.report.tempF !== null ? `${Math.round(p.report.tempF)}°F` : null,
									p.report.weather || null,
									p.report.updated
										? `updated ${ago(new Date(p.report.updated).toISOString())}`
										: null
								]
									.filter(Boolean)
									.join(' · ')}
							</span>
							{#each p.report.restrictions.filter((r) => !/^no restrictions/i.test(r.text)) as r (r.direction + r.text)}
								<span class="pass-detail"
									><strong>{r.direction || 'Restriction'}:</strong> {r.text}</span
								>
							{/each}
							{#if p.report.road}<span class="pass-detail">{p.report.road.slice(0, 160)}</span>{/if}
						{:else if !p.report}
							<span class="pass-detail">Cameras and forecast. No live pass report here yet.</span>
						{:else if p.report}
							<span class="pass-detail"
								>{firstSentence(p.report.road) ||
									'WSDOT is not reporting this pass right now.'}</span
							>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/each}
	<p class="hint">
		Reports come from WSDOT and are updated by hand, mostly November through April. Always check
		<a href="https://wsdot.com/travel/real-time/mountainpasses" target="_blank" rel="noopener"
			>WSDOT's pass page</a
		>
		before you go. WSDOT has no public camera on the North Cascades Highway itself. For Oregon, check
		<a href="https://tripcheck.com/" target="_blank" rel="noopener">TripCheck</a>.
	</p>
</main>
