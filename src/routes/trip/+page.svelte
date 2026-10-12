<script lang="ts">
	import { track } from '../../lib/track';
	import { APP_NAME } from '../../lib/brand';
	import { page } from '$app/state';
	import CameraList from '../../lib/CameraList.svelte';
	import ConditionsBar from '../../lib/ConditionsBar.svelte';
	import SnowLine from '../../lib/SnowLine.svelte';
	import RouteWeather from '../../lib/RouteWeather.svelte';
	import OfflineCameras from '../../lib/OfflineCameras.svelte';
	import TripForm from '../../lib/TripForm.svelte';
	import ShareButton from '../../lib/ShareButton.svelte';
	import { tripShareParams } from '../../lib/sharing';
	import { duration } from '../../lib/format';
	import { rememberPlace } from '../../lib/lastPlace';
	import { rememberRecent } from '../../lib/recents';
	import { cumulativeMiles, projectOnRoute } from '../../lib/route';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const trip = $derived(data.trip);

	$effect(() => {
		if (!trip) return;
		rememberPlace(location.pathname + location.search);
		rememberRecent({ kind: 'trip', from: trip.from, to: trip.to });
	});

	// Follow mode: use the phone's location to drop cameras you have already passed.
	let following = $state(false);
	let progress = $state<number | null>(null);
	let offRoute = $state(false);
	let gpsError = $state('');
	let watchId: number | null = null;
	let wakeLock: { release: () => Promise<void> } | null = null;

	// The same drive the other way: start and destination swap, and the stops come in reverse order.
	function reverseLink(): string {
		const p = page.url.searchParams;
		const q = new URLSearchParams();
		for (const [key, other] of [
			['from', 'to'],
			['to', 'from'],
			['fl', 'tl'],
			['tl', 'fl']
		]) {
			const v = p.get(other);
			if (v) q.set(key, v);
		}
		const via = p.get('via');
		if (via) q.set('via', via.split(';').reverse().join(';'));
		return `/trip?${q}`;
	}

	function tripLink(changes: Record<string, string | null>): string {
		const u = new URL(page.url.href);
		for (const [k, v] of Object.entries(changes)) {
			if (v === null) u.searchParams.delete(k);
			else u.searchParams.set(k, v);
		}
		return `${u.pathname}${u.search}`;
	}

	const cum = $derived(trip ? cumulativeMiles(trip.route) : []);

	function stopFollowing() {
		following = false;
		progress = null;
		offRoute = false;
		if (watchId !== null) navigator.geolocation.clearWatch(watchId);
		watchId = null;
		void wakeLock?.release().catch(() => {});
		wakeLock = null;
	}

	async function startFollowing() {
		gpsError = '';
		if (!navigator.geolocation) {
			gpsError = 'Location is not available on this device.';
			return;
		}
		following = true;
		track('follow-trip');
		try {
			wakeLock =
				(await (
					navigator as Navigator & {
						wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
					}
				).wakeLock?.request('screen')) ?? null;
		} catch {
			// keeping the screen on is optional
		}
		watchId = navigator.geolocation.watchPosition(
			(pos) => {
				if (!trip) return;
				const p = projectOnRoute(
					{ lat: pos.coords.latitude, lon: pos.coords.longitude },
					trip.route,
					cum
				);
				offRoute = p.off > 1;
				progress = offRoute ? null : p.along;
			},
			() => {
				gpsError = 'Could not get your location. Check that location is allowed for this site.';
				stopFollowing();
			},
			{ enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
		);
	}

	$effect(() => () => stopFollowing());

	const ahead = $derived(
		trip ? trip.stops.filter((s) => progress === null || s.along >= progress - 0.3) : []
	);
	const passed = $derived(
		trip ? trip.stops.filter((s) => progress !== null && s.along < progress - 0.3) : []
	);
	const next = $derived(progress !== null ? ahead[0] : undefined);
	const noteFor = (along: number) =>
		progress !== null
			? `${Math.max(0, along - progress).toFixed(1)} mi ahead`
			: `${along.toFixed(0)} mi from start`;
</script>

<svelte:head>
	<title>{trip ? `${trip.from} to ${trip.to} · ${APP_NAME}` : `Plan a drive · ${APP_NAME}`}</title>
</svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">Plan a drive</span>
</header>

<main>
	{#if !trip}
		<h1>Where to?</h1>
		<p class="lede-dark">See the cameras along your drive, in the order you'll pass them.</p>
		{#if data.error}<p class="error">{data.error}</p>{/if}
		<TripForm from={data.fromQ} to={data.toQ} places={[]} />
	{:else}
		<section class="summary">
			<h1>{trip.from} → {trip.to}</h1>
			<p class="sub">
				{trip.miles.toFixed(0)} mi · about {duration(trip.minutes)}{trip.viaCount
					? ` · via ${trip.viaCount} ${trip.viaCount === 1 ? 'stop' : 'stops'}`
					: ''} · {trip.stops.length} cameras on the way
			</p>
			<div class="reverse page-actions">
				<ShareButton
					path="/trip?{tripShareParams(page.url.searchParams)}"
					title="{trip.from} to {trip.to}"
					text="Driving {trip.from} to {trip.to}: cameras, weather and passes on the way"
				/>
				<a class="chip" href={reverseLink()} onclick={() => track('reverse-trip')}
					>⇄ Reverse this drive</a
				>
			</div>
			<nav class="leave" aria-label="When are you leaving?">
				<span class="leave-label">Leave</span>
				{#each [[0, 'Now'], [60, 'In 1 h'], [120, 'In 2 h'], [180, 'In 3 h']] as [mins, text] (mins)}
					<a
						class="chip"
						aria-current={trip.leaveIn === mins ? 'true' : undefined}
						href={tripLink({ in: mins ? String(mins) : null })}
						onclick={() => mins && track('leave-later')}
					>
						{text}
					</a>
				{/each}
			</nav>
			<div class="follow">
				{#if !following}
					<button onclick={startFollowing}>Follow my trip</button>
				{:else}
					<button class="secondary" onclick={stopFollowing}>Stop following</button>
				{/if}
			</div>
			{#if gpsError}<p class="error">{gpsError}</p>{/if}
			{#if following && progress === null && !offRoute && !gpsError}
				<p class="sub">Finding your position…</p>
			{/if}
			{#if offRoute}
				<p class="notice">You're off the planned route, so every camera is shown again.</p>
			{/if}
			{#if next}
				<p class="next-up">
					Next: <strong>{next.camera.name}</strong> in {Math.max(
						0,
						next.along - (progress ?? 0)
					).toFixed(1)} mi
				</p>
			{/if}
		</section>

		{#await trip.snow then snow}
			{#if snow}<SnowLine
					{snow}
					demo={trip.demoWinter}
					miles={trip.miles}
					minutes={trip.minutes}
					stops={trip.stops}
				/>{/if}
		{/await}

		{#await trip.onTheWay then onTheWay}
			{#if onTheWay}<RouteWeather weather={onTheWay} leaveIn={trip.leaveIn} />{/if}
		{/await}

		{#await trip.conditions}
			<p class="loading">Loading conditions…</p>
		{:then conditions}
			<ConditionsBar {conditions} mode="trip" />
		{/await}

		{#if !trip.showingAll}
			<p class="thinned">
				Showing {trip.stops.length} key cameras of {trip.totalCameras}.
				<a href={tripLink({ all: '1' })}>Show all {trip.totalCameras}</a>
			</p>
		{:else if trip.totalCameras > 40}
			<p class="thinned">
				Showing all {trip.totalCameras} cameras. <a href={tripLink({ all: null })}>Show fewer</a>
			</p>
		{/if}

		{#if ahead.length}
			<CameraList
				items={ahead.map((stop) => ({
					camera: { ...stop.camera, distance: stop.along },
					note: noteFor(stop.along)
				}))}
			/>
		{:else if trip.stops.length}
			<p class="empty">You've passed every camera on this drive.</p>
		{:else}
			<p class="empty">No cameras along this drive yet.</p>
		{/if}

		{#if passed.length}
			<details class="passed">
				<summary>Passed ({passed.length})</summary>
				<ul>
					{#each passed as stop (stop.camera.id)}<li>{stop.camera.name}</li>{/each}
				</ul>
			</details>
		{/if}

		<OfflineCameras cameras={trip.offline} />

		{#if trip.stops.some((s) => s.camera.view)}
			<p class="courtesy">
				Webcams provided by <a href="https://www.windy.com/" target="_blank" rel="noopener"
					>windy.com</a
				>
				&mdash;
				<a href="https://www.windy.com/webcams/add" target="_blank" rel="noopener">add a webcam</a>
			</p>
		{/if}

		<details class="change-trip">
			<summary>Change trip</summary>
			<TripForm from={data.fromQ} to={data.toQ} places={[]} />
		</details>
	{/if}
</main>
