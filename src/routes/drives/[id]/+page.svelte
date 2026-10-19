<script lang="ts">
	import CrossingStrip from '../../../lib/CrossingStrip.svelte';
	import StatusPill from '../../../lib/StatusPill.svelte';
	import VehiclePicker from '../../../lib/VehiclePicker.svelte';
	import { ago, duration } from '../../../lib/format';
	import { loadVehicle, passAnswer, VEHICLES, type Vehicle } from '../../../lib/vehicle';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	// Car until the visitor picks something else (kept on the device), as on the passes list.
	let vehicle = $state<Vehicle | null>(null);
	$effect(() => {
		vehicle = loadVehicle() ?? 'car';
	});
	const short = $derived(VEHICLES.find((v) => v.id === vehicle)?.short ?? '');
	const leaveLink = (mins: number) => (mins ? `${data.tripLink}&in=${mins}` : data.tripLink);
	// A drive that ends at a pass shows its report, but doesn't go over it.
	const crossed = $derived(
		data.route ? data.passes.filter((p) => p.along < data.route!.miles).map((p) => p.name) : []
	);
</script>

<svelte:head><title>{data.pageTitle}</title></svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">Popular drives</span>
</header>

<main>
	<h1>{data.drive.name}</h1>
	{#if data.drive.blurb}<p class="lede-dark">{data.drive.blurb}</p>{/if}
	{#if data.route}
		<p class="sub">
			{Math.round(data.route.miles)} mi · about {duration(data.route.minutes)}{crossed.length
				? ` · over ${crossed.join(' and ')}`
				: ''}
		</p>
	{/if}
	<a class="drive-go" href={data.tripLink}>See the drive now</a>
	<p class="drive-go-note">
		The road cameras in the order you'll pass them, the weather for when you get there, and Follow
		to keep up as you drive.
	</p>

	{#each data.avoided as a (a.closed)}
		<p class="notice">
			{a.closed} is closed. The drive goes over {a.instead} instead{a.extraMinutes
				? `, about ${duration(a.extraMinutes)} longer`
				: ''}.
		</p>
	{/each}
	{#if data.blocked.length}
		<p class="notice">
			{data.blocked.join(' and ')}
			{data.blocked.length === 1 ? 'is' : 'are'} closed, with no open way around.
		</p>
	{/if}

	{#if data.passes.length}
		<h2 class="section-title">
			The {data.passes.length === 1 ? 'pass' : 'passes'}{crossed.length ? ' on the way' : ''}
		</h2>
		<VehiclePicker bind:vehicle label="I'm driving:" />
		<ul class="pass-list">
			{#each data.passes as p (p.id)}
				<li>
					<a href="/passes/{encodeURIComponent(p.id)}">
						<span class="pass-top">
							<span class="place-name">{p.name}</span>
							{#if p.report}<StatusPill tone={p.report.status} label={p.report.label} />{/if}
						</span>
						<span class="place-sub">{p.route} · {p.source}'s report</span>
						{#if vehicle}
							<span class="pass-detail pass-answer"
								>For your {short}: {passAnswer(p.report, vehicle, p.heading).text}</span
							>
						{/if}
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
						{/if}
					</a>
				</li>
			{/each}
		</ul>
		{#await data.crossing then crossing}
			{#if crossing}<CrossingStrip {crossing} leaveIn={0} link={leaveLink} />{/if}
		{/await}
	{/if}

	<h2 class="section-title">On the drive page</h2>
	<ul class="drive-features">
		{#if data.passes.length}
			<li><strong>When to leave</strong> to miss the snow at the summit, up to a day ahead.</li>
			<li>
				<strong>Chains for your car</strong>: what the rule means for a car, an AWD or when towing.
			</li>
			<li>
				<strong>A closed road</strong>: whether it's still closed when you get there, and the other
				way across that misses it.
			</li>
		{/if}
		<li><strong>Every road camera</strong> on the way, in the order you'll pass them.</li>
		<li><strong>The weather</strong> at each town and pass for the time you get there.</li>
		<li><strong>Follow</strong>: leave it open as you drive and it drops cameras you've passed.</li>
	</ul>

	{#if data.others.length}
		<h2 class="section-title">Other drives</h2>
		<nav class="drives" aria-label="Other drives">
			{#each data.others as d (d.id)}
				<a class="drive" href="/drives/{encodeURIComponent(d.id)}">
					<span class="place-name">{d.name}</span>
					{#if d.blurb}<span class="place-sub">{d.blurb}</span>{/if}
				</a>
			{/each}
		</nav>
	{/if}
</main>

<style>
	.drive-go {
		display: block;
		margin-top: 14px;
		padding: 14px 18px;
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--on-accent);
		text-align: center;
		text-decoration: none;
		font-weight: 600;
	}
	.drive-go-note {
		margin: 6px 0 0;
		color: var(--muted);
		font-size: var(--fs-sm);
	}
	.drive-features {
		margin: 0;
		padding-left: 1.2em;
		display: grid;
		gap: 6px;
	}
</style>
