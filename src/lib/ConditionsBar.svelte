<script lang="ts">
	import StatusPill from './StatusPill.svelte';
	import { pickHeadlines } from './headlines';
	import { returnLabel } from './format';
	import type { Conditions } from './types';

	let { conditions, mode = 'place' }: { conditions: Conditions[]; mode?: 'place' | 'trip' } =
		$props();

	const label: Record<Conditions['kind'], string> = {
		forecast: 'Forecast',
		station: 'Station',
		'pass-conditions': 'Roads',
		waves: 'Surf',
		tides: 'Tides',
		ferry: 'Sailings',
		border: 'Border wait',
		airport: 'Flight delays',
		river: 'River'
	};
	const live = $derived(conditions.filter((c) => c.state === 'ok'));
	const quiet = $derived(conditions.filter((c) => c.state !== 'ok'));
	// A few reports up front; the rest wait behind "more reports" so cameras are never far down the page.
	const picked = $derived(pickHeadlines(live, mode));
	// Road reports say which road; everything else just says what kind of report it is.
	const quietName = (c: Conditions) => (c.kind === 'pass-conditions' ? c.name : label[c.kind]);
	const quietText = $derived(
		quiet
			.map((c) => {
				const back = returnLabel(c.returns);
				return c.state === 'dormant'
					? `${quietName(c)}: seasonal${back ? `, back ${back}` : ''}`
					: `${quietName(c)}: unavailable`;
			})
			.join(' · ')
	);

	const title = (c: Conditions) =>
		c.kind === 'border'
			? c.name.replace(/ wait times$/, '')
			: c.kind === 'forecast' || c.kind === 'station' || c.kind === 'river'
				? c.name
				: label[c.kind];
	const row = (c: Conditions, name: string) => c.rows.find((r) => r.label === name)?.value;
</script>

{#snippet item(c: Conditions)}
	<div class="wx">
		<span class="wx-kind"
			>{title(c)}{c.kind === 'forecast' && c.at ? ' · when you get there' : ''}</span
		>
		{#if c.kind === 'pass-conditions'}
			{#if c.badge}<StatusPill tone={c.badge.tone} label={c.badge.label} />{/if}
			<span
				>{c.rows
					.slice(1)
					.map((r) => `${r.label}: ${r.value}`)
					.join(' · ')}</span
			>
		{:else if c.kind === 'river'}
			<span
				>{row(c, 'Level')}{row(c, 'Forecast high')
					? ` · forecast high ${row(c, 'Forecast high')}`
					: ''}</span
			>
			{#if row(c, 'Flood stage')}
				<details>
					<summary>Flood stage</summary>
					<ul>
						<li>{row(c, 'Flood stage')}</li>
					</ul>
				</details>
			{/if}
		{:else if c.kind === 'ferry'}
			{#if c.glance}<span class="glance glance-{c.glance.tone}">{c.glance.text}</span>{/if}
			<span>{c.rows[0].label} {c.rows[0].value}</span>
			{#if c.rows.length > 1}
				<details>
					<summary>Next sailings</summary>
					<ul>
						{#each c.rows.slice(1) as r (r.label)}<li>{r.label} {r.value}</li>{/each}
					</ul>
				</details>
			{/if}
		{:else if c.kind === 'airport'}
			<span>{c.rows.map((r) => `${r.label}: ${r.value}`).join(' · ')}</span>
		{:else if c.kind === 'forecast'}
			<span>{c.rows[0].label}: {c.rows[0].value}</span>
			{#if c.rows.length > 1}
				<details>
					<summary>Next</summary>
					<ul>
						{#each c.rows.slice(1) as r (r.label)}<li>{r.label}: {r.value}</li>{/each}
					</ul>
				</details>
			{/if}
		{:else}
			<span>{c.rows.map((r) => `${r.label} ${r.value}`).join(' · ')}</span>
		{/if}
	</div>
{/snippet}

{#if conditions.length}
	<section class="wx-bar" aria-label="Current conditions">
		{#each picked.primary as c (c.id)}{@render item(c)}{/each}
		{#if picked.more.length}
			<details class="wx-more">
				<summary>{picked.more.length} more reports</summary>
				{#each picked.more as c (c.id)}{@render item(c)}{/each}
			</details>
		{/if}
		{#if quietText}<p class="wx-quiet">{quietText}</p>{/if}
	</section>
{:else if mode === 'place'}
	<p class="wx-quiet">No weather reports near here right now.</p>
{/if}
