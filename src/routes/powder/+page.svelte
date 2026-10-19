<script lang="ts">
	import { untrack } from 'svelte';
	import PlaceInput from '../../lib/PlaceInput.svelte';
	import SkiSnowLine from '../../lib/SkiSnowLine.svelte';
	import StatusPill from '../../lib/StatusPill.svelte';
	import { duration } from '../../lib/format';
	import { track } from '../../lib/track';
	import { loadVehicle, NEED_TONE, passAnswer, type Vehicle } from '../../lib/vehicle';
	import type { PowderWay } from '../../lib/server/powder';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	// The box starts with the last search; after that it's the visitor's to change.
	let fromText = $state(untrack(() => data.fromQ));
	let locating = $state(false);
	let gpsError = $state('');
	let vehicle = $state<Vehicle>('car');
	$effect(() => {
		vehicle = loadVehicle() ?? 'car';
	});
	// The drives to the first five (around closed passes, with their passes) arrive after the list.
	let ways = $state<Record<string, PowderWay> | null>(null);
	$effect(() => {
		ways = null;
		const pending = data.ways;
		void pending?.then((w) => {
			if (data.ways === pending) ways = w;
		});
	});

	function useMyLocation() {
		gpsError = '';
		if (!navigator.geolocation) {
			gpsError = 'Location is not available on this device.';
			return;
		}
		locating = true;
		track('use-location');
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				fromText = `${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`;
				locating = false;
			},
			() => {
				locating = false;
				gpsError = 'Could not get your location.';
			},
			{ timeout: 10000 }
		);
	}
	const tripLink = (id: string) =>
		`/trip?from=${encodeURIComponent(data.fromQ)}&to=${encodeURIComponent(id)}${data.from?.label === 'Your location' ? '&fl=Your%20location' : ''}`;
</script>

{#snippet head(s: { id: string; name: string }, minutes: number)}
	<div class="powder-head">
		<a class="powder-name" href="/search?place={encodeURIComponent(s.id)}">{s.name}</a>
		<span class="powder-drive">{duration(minutes)} drive</span>
	</div>
{/snippet}

<svelte:head
	><title>Powder Day: Ski Areas With the Most New Snow Near You · What's Up Ahead</title
	></svelte:head
>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">Powder day</span>
</header>

<main>
	<h1>Powder day</h1>
	<p class="lede-dark">
		The ski areas within a few hours' drive of you, most new snow first. Drive times follow real
		roads, and the snow comes from independent USDA gauges.
	</p>

	<form method="GET" class="trip-form powder-form">
		<label>
			From
			<span class="row">
				<PlaceInput
					name="from"
					bind:value={fromText}
					placeholder="Town, zip or address"
					label="Start"
					required
				/>
				<button type="button" class="secondary" onclick={useMyLocation} disabled={locating}>
					{locating ? '…' : 'Here'}
				</button>
			</span>
		</label>
		<label>
			Within
			<select name="hours" value={String(data.hours)}>
				{#each data.choices as h (h)}<option value={String(h)}>{h} hours' drive</option>{/each}
			</select>
		</label>
		<button type="submit">Find snow</button>
		{#if gpsError}<p class="error">{gpsError}</p>{/if}
	</form>

	{#if data.error}<p class="error">{data.error}</p>{/if}

	{#if data.spots}
		{#await data.spots}
			<p class="loading">Working out the drives and the snow…</p>
		{:then spots}
			{#if spots === null}
				<p class="error">Couldn't work out the drives just now. Try again in a minute.</p>
			{:else if !spots.length}
				<p class="empty">No ski areas within {data.hours} hours' drive of {data.from?.label}.</p>
			{:else}
				<ol class="powder-list">
					{#each spots as s (s.id)}
						{@const way = ways?.[s.id]}
						<li class="card powder-spot">
							{@render head(s, way?.minutes ?? s.minutes)}
							{#if s.state}<span class="sub">{s.state}</span>{/if}
							{#if s.snow}<SkiSnowLine snow={s.snow} />{:else}<span class="sub"
									>No snow gauge near</span
								>{/if}
							{#if way?.blocked.length}
								<p class="error">{way.blocked.join(' and ')} closed, with no open way around.</p>
							{:else if way?.avoided.length}
								<p class="sub">Goes around {way.avoided.join(' and ')} (closed).</p>
							{/if}
							{#if way?.passes.length}
								<div class="powder-passes">
									{#each way.passes as p (p.id)}
										{@const a = p.report ? passAnswer(p.report, vehicle, p.heading) : null}
										<span class="powder-pass"
											>{p.name}: <StatusPill
												tone={a ? NEED_TONE[a.need] : 'off-season'}
												label={a ? a.text : 'No report'}
											/></span
										>
									{/each}
								</div>
							{/if}
							<a class="powder-go" href={tripLink(s.id)}>Plan the drive →</a>
						</li>
					{/each}
				</ol>
				<p class="sub">
					Ranked by new snow in the last 24 hours at the nearest USDA SNOTEL gauge, then since 6 AM,
					then today's forecast (Open-Meteo). Drive times are from the free OSRM routing service,
					without traffic. Passes and chain rules are shown for the five at the top, for a {vehicle ===
					'car'
						? 'car'
						: vehicle === 'awd'
							? 'AWD or 4WD'
							: 'vehicle towing'} (change it on any drive page).
				</p>
			{/if}
		{/await}
	{/if}
</main>
