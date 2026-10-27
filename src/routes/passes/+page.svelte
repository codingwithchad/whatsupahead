<script lang="ts">
	import StatusPill from '../../lib/StatusPill.svelte';
	import ListControls from '../../lib/ListControls.svelte';
	import ShareButton from '../../lib/ShareButton.svelte';
	import VehiclePicker from '../../lib/VehiclePicker.svelte';
	import { loadVehicle, passAnswer, VEHICLES, type Vehicle } from '../../lib/vehicle';
	import { ago } from '../../lib/format';
	import { loadOpenStates, saveOpenState } from '../../lib/openStates';
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
	// States start folded (a single state starts open); the ones this visitor opened before open again.
	let opened = $state<Record<string, boolean>>({});
	$effect(() => {
		opened = loadOpenStates();
	});
	// One area picked (`?in=`) opens its states.
	const isOpen = (name: string) => data.area !== null || (opened[name] ?? data.states.length === 1);
	const toggled = (name: string) => (e: Event) => {
		const open = (e.currentTarget as HTMLDetailsElement).open;
		if (open !== isOpen(name)) {
			opened[name] = open;
			saveOpenState(name, open);
		}
	};
	// Chains for the visitor's vehicle, when they have picked one (kept on the device).
	let vehicle = $state<Vehicle | null>(null);
	$effect(() => {
		// One choice is always picked, Car until someone says otherwise, so the chips never read as a list of
		// vehicles that need chains.
		vehicle = loadVehicle() ?? 'car';
	});
	const short = $derived(VEHICLES.find((v) => v.id === vehicle)?.short ?? '');
	// Worst first (the default November to April): closed, then chains, then traction, then open; passes with no
	// report, then roads shut for the winter (Tioga, the North Cascades Highway: closed all season is not news), last.
	// Ties keep the road order of the state lists.
	const month = new Date().getMonth();
	let sort = $state(month >= 10 || month <= 3 ? 'worst' : 'state');
	const RANK: Record<string, number> = {
		closed: 0,
		chains: 1,
		traction: 2,
		open: 3,
		'off-season': 4
	};
	const winterShut = (p: { winter_closure?: string; report: { status: string } | null }) =>
		Boolean(p.winter_closure) &&
		(p.report?.status === 'closed' || p.report?.status === 'off-season');
	const worstFirst = $derived(
		data.states
			.flatMap((st) => st.groups.flatMap((g) => g.passes))
			.map((p, i) => ({ p, i, r: winterShut(p) ? 6 : (RANK[p.report?.status ?? ''] ?? 5) }))
			.sort((a, b) => a.r - b.r || a.i - b.i)
			.map((x) => x.p)
	);
	// The first sentence of WSDOT's note, for passes that are not reporting right now.
	const firstSentence = (s: string) => (s.match(/^.*?[.!](\s|$)/)?.[0] ?? s).trim().slice(0, 140);
</script>

<svelte:head><title>{data.title} · What's Up Ahead</title></svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">Mountain passes</span>
</header>

<main>
	<h1>{data.title}</h1>
	<p class="lede-dark">
		{#if data.area}Open or closed, chains and conditions from each state's own reports, with cameras
			and forecasts for each.{:else}Open or closed, chains and conditions for mountain passes in
			Washington, Oregon, California, Idaho, Nevada and Utah, from each state's own reports, with
			cameras and forecasts for each.{/if}
	</p>
	<div class="page-actions">
		<ShareButton
			path={data.path}
			title={data.title}
			text="{data.title}: open or closed, chains and cameras"
		/>
	</div>

	{#if data.reachable}
		<p class="pass-summary">
			{#each order.filter((o) => counts[o]) as o, i (o)}{i ? ' · ' : ''}<strong>{counts[o]}</strong>
				{names[o]}{/each}
		</p>
		{#if data.counts['off-season']}
			<p class="sub">
				Winter reports usually run November to April. Until they start, some passes have no official
				report: check the cameras and the forecast.
			</p>
		{/if}
	{:else}
		<p class="place-note">
			Pass reports aren't loading right now. Each pass page still shows its cameras and forecast.
		</p>
	{/if}

	{#if data.reachable}
		<p class="ra-ask">
			Chains and traction tires for what you're driving (<a href="/tires">what's a traction tire?</a
			>):
		</p>
		<VehiclePicker bind:vehicle />
	{/if}

	{#snippet passItem(p: (typeof data.states)[number]['groups'][number]['passes'][number])}
		<li>
			<a href={p.href}>
				<span class="pass-top">
					<span class="place-name">{p.name}</span>
					{#if p.report}<StatusPill tone={p.report.status} label={p.report.label} />{/if}
				</span>
				<span class="place-sub"
					>{[p.route, p.elevation_ft ? `${p.elevation_ft.toLocaleString()} ft` : null, p.connects]
						.filter(Boolean)
						.join(' · ')}</span
				>
				{#if vehicle && p.report && p.report.status !== 'off-season'}
					<span class="pass-detail pass-answer"
						>For your {short}: {passAnswer(p.report, vehicle).text}</span
					>
				{/if}
				{#if p.report && p.report.status !== 'off-season'}
					<span class="pass-detail">
						{[
							p.report.tempF !== null ? `${Math.round(p.report.tempF)}°F` : null,
							p.report.weather || null,
							p.report.updated ? `updated ${ago(new Date(p.report.updated).toISOString())}` : null
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
						>{firstSentence(p.report.road) || 'No report for this pass right now.'}</span
					>
				{/if}
				{#if p.winter_closure}<span class="pass-detail">{p.winter_closure}.</span>{/if}
			</a>
		</li>
	{/snippet}

	<ListControls
		sorts={[
			{ id: 'worst', label: 'Worst first' },
			{ id: 'state', label: 'By state' }
		]}
		bind:sort
		storageKey="pass-sort"
		areas={data.areas}
		area={data.area}
		base="/passes"
	/>

	{#if sort === 'worst'}
		<p class="sub">
			Closed first, then chains, then traction tires, then open. Roads closed for the winter last.
		</p>
		<ul class="pass-list">
			{#each worstFirst as p (p.id)}{@render passItem(p)}{/each}
		</ul>
	{:else}
		{#each data.states as st (st.name)}
			<details class="tree-region state-fold" open={isOpen(st.name)} ontoggle={toggled(st.name)}>
				<summary>
					<span class="tree-name">{st.name}</span>
					<span class="tree-count"
						>{[
							`${st.count} passes`,
							st.closed ? `${st.closed} closed` : null,
							st.chains ? `${st.chains} chains` : null
						]
							.filter(Boolean)
							.join(' · ')}</span
					>
				</summary>
				<div class="state-body">
					{#each st.groups as g (g.name)}
						{#if st.groups.length > 1 || g.name !== st.name}<h2 class="section-title">
								{g.name}
							</h2>{/if}
						<ul class="pass-list">
							{#each g.passes as p (p.id)}{@render passItem(p)}{/each}
						</ul>
					{/each}
				</div>
			</details>
		{/each}
	{/if}
	<p class="hint">
		Reports come from WSDOT, ODOT, Caltrans, Idaho's ITD, Nevada's NDOT and Utah's UDOT; crews
		update them by hand, mostly November through April. Always check the state's own page before you
		go:
		<a href="https://wsdot.com/travel/real-time/mountainpasses" target="_blank" rel="noopener"
			>WSDOT's pass page</a
		>,
		<a href="https://tripcheck.com/" target="_blank" rel="noopener">TripCheck</a> for Oregon,
		<a href="https://quickmap.dot.ca.gov/" target="_blank" rel="noopener">Caltrans QuickMap</a> for
		California,
		<a href="https://511.idaho.gov/" target="_blank" rel="noopener">Idaho 511</a>,
		<a href="https://www.nvroads.com/" target="_blank" rel="noopener">Nevada 511</a> or
		<a href="https://www.udottraffic.utah.gov/" target="_blank" rel="noopener">UDOT Traffic</a> for Utah.
		WSDOT has no public camera on the North Cascades Highway itself.
	</p>
</main>
