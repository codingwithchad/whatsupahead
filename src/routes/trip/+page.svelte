<script lang="ts">
	import { track } from '../../lib/track';
	import { APP_NAME } from '../../lib/brand';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import CameraList from '../../lib/CameraList.svelte';
	import ConditionsBar from '../../lib/ConditionsBar.svelte';
	import SnowLine from '../../lib/SnowLine.svelte';
	import RouteWeather from '../../lib/RouteWeather.svelte';
	import RoadAhead from '../../lib/RoadAhead.svelte';
	import OfflineCameras from '../../lib/OfflineCameras.svelte';
	import TripForm from '../../lib/TripForm.svelte';
	import ShareButton from '../../lib/ShareButton.svelte';
	import { tripShareParams } from '../../lib/sharing';
	import { duration, localClock } from '../../lib/format';
	import { tripChanges, type Change, type Snapshot } from '../../lib/tripChanges';
	import { driveVerdict } from '../../lib/verdict';
	import { loadVehicle, type Vehicle } from '../../lib/vehicle';
	import { timeZoneAt } from '../../lib/regions';
	import VerdictCard from '../../lib/VerdictCard.svelte';
	import VehiclePicker from '../../lib/VehiclePicker.svelte';
	import type { RouteWeather as RouteWeatherData } from '../../lib/routeWeather';
	import type { RoadWarnings } from '../../lib/roadAhead';
	import type { LiveUpdate } from '../../lib/server/tripLive';
	import { rememberPlace } from '../../lib/lastPlace';
	import { rememberRecent } from '../../lib/recents';
	import { cumulativeMiles, projectOnRoute } from '../../lib/route';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const trip = $derived(data.trip);

	$effect(() => {
		if (!trip) return;
		rememberPlace(location.pathname + location.search);
		// A drive planned again from where you are is the same trip, not a new one to list.
		if (!page.url.searchParams.has('of'))
			rememberRecent({ kind: 'trip', from: trip.from, to: trip.to });
	});

	// Follow mode: use the phone's location to drop cameras you have already passed.
	let following = $state(false);
	let progress = $state<number | null>(null);
	let offRoute = $state(false);
	let gpsError = $state('');
	let gpsLost = $state(false);
	let watchId: number | null = null;
	let wakeLock: { release: () => Promise<void> } | null = null;
	// Leaving the planned route for a minute plans the drive again from where you are.
	let offSince: number | null = null;
	let lastReplan = 0;
	let lastProgress = 0;
	let replanned = $state(false);
	let timedFromHere = false;
	// The first update after you start following is read aloud as the drive at a glance.
	let sayVerdict = false;

	// ---- Fresh while open ----------------------------------------------------------------------------------
	// A drive page left open on the dash asks every 5 minutes (and when the screen comes back on) for fresh pass
	// reports, warnings and weather, and says what got worse on the road ahead. It sends the route it already
	// has, so no new route is worked out. While following, every time counts from where you are now.
	const REFRESH_MS = 5 * 60 * 1000;
	let live = $state<LiveUpdate | null>(null);
	let updatedAt = $state<number | null>(null);
	let refreshing = $state(false);
	let refreshFailed = $state(false);
	let changes = $state<{ at: number; list: Change[] } | null>(null);
	let speak = $state(true);
	let lastSnapshot: Snapshot | null = null;
	// What the page loaded with, once the streamed parts arrive (the at-a-glance card needs the values).
	let firstWarnings = $state<RoadWarnings | null>(null);
	let firstWeather = $state<RouteWeatherData | null>(null);
	let vehicle = $state<Vehicle | null>(null);
	$effect(() => {
		vehicle = loadVehicle();
	});

	const SPEAK_KEY = 'speak-changes';
	$effect(() => {
		try {
			speak = localStorage.getItem(SPEAK_KEY) !== 'off';
		} catch {
			// remembering is optional
		}
	});
	function saveSpeak() {
		try {
			localStorage.setItem(SPEAK_KEY, speak ? 'on' : 'off');
		} catch {
			// remembering is optional
		}
	}

	// A new drive (or the same one planned again) starts over: what it loaded with is the first snapshot.
	$effect(() => {
		const t = trip;
		live = null;
		changes = null;
		lastSnapshot = null;
		firstWarnings = null;
		firstWeather = null;
		refreshFailed = false;
		updatedAt = Date.now();
		if (!t) return;
		// Planned again while following: place yourself on the new route without waiting for the next fix.
		untrack(() => {
			if (following && lastPos) {
				const { lat, lon } = lastPos;
				queueMicrotask(() => onPosition(lat, lon));
			}
		});
		Promise.all([t.warnings, t.onTheWay])
			.then(([warnings, onTheWay]) => {
				if (data.trip !== t) return;
				lastSnapshot ??= { passes: t.road.passes, warnings, onTheWay };
				firstWarnings = warnings;
				firstWeather = onTheWay;
			})
			.catch(() => {});
	});

	/** At most about 2,500 points of the route: plenty to find what is beside it, small to send. */
	function thinRoute(route: [number, number][]): [number, number][] {
		const step = Math.ceil(route.length / 2500);
		return route.filter((_, i) => i % step === 0 || i === route.length - 1);
	}

	const clock = (ms: number) => localClock(ms);

	function announce(list: Change[]) {
		changes = { at: Date.now(), list };
		if (list.some((c) => c.tone === 'danger')) navigator.vibrate?.([200, 100, 200]);
		if (following && speak && 'speechSynthesis' in window)
			for (const c of list.slice(0, 3))
				speechSynthesis.speak(new SpeechSynthesisUtterance(c.text.replace(/°F/g, ' degrees')));
	}

	async function refresh() {
		const t = trip;
		if (!t || refreshing) return;
		refreshing = true;
		try {
			// While following: the start time that puts you where you are now.
			const startAt =
				following && progress !== null
					? Date.now() - (t.minutes * 60_000 * progress) / Math.max(t.miles, 0.1)
					: t.startAt;
			const res = await fetch('/api/trip/live', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					route: thinRoute(t.route),
					minutes: t.minutes,
					startAt,
					from: t.fromPoint,
					to: t.toPoint,
					demo: t.demoWinter
				})
			});
			if (!res.ok) throw new Error(`update ${res.status}`);
			const update = (await res.json()) as LiveUpdate;
			if (data.trip !== t) return;
			const snap: Snapshot = {
				passes: update.passes,
				warnings: update.warnings,
				onTheWay: update.onTheWay
			};
			if (lastSnapshot) {
				const list = tripChanges(lastSnapshot, snap, following ? progress : null, (ms) =>
					clock(ms)
				);
				if (list.length) announce(list);
			}
			lastSnapshot = snap;
			live = update;
			if (sayVerdict && following && speak && 'speechSynthesis' in window) {
				sayVerdict = false;
				queueMicrotask(() => {
					if (verdict)
						speechSynthesis.speak(
							new SpeechSynthesisUtterance(
								`${verdict.title}. ${verdict.sentence}`.replace(/°F/g, ' degrees')
							)
						);
				});
			}
			updatedAt = update.at;
			refreshFailed = false;
		} catch {
			refreshFailed = true;
		} finally {
			refreshing = false;
		}
	}

	$effect(() => {
		if (!trip) return;
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') void refresh();
		}, REFRESH_MS);
		const onVisible = () => {
			if (document.visibilityState === 'visible' && Date.now() - (updatedAt ?? 0) > 60_000)
				void refresh();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	/** Plan the drive again from here, keeping the destination and the stops still ahead. */
	function replan(lat: number, lon: number) {
		lastReplan = Date.now();
		const p = page.url.searchParams;
		const q = new URLSearchParams(p.toString());
		// The original start stays in the link, so sharing this drive never shares where you are.
		if (!q.has('of')) {
			q.set('of', p.get('from') ?? '');
			const fl = p.get('fl');
			if (fl) q.set('ofl', fl);
		}
		q.set('from', `${lat.toFixed(4)},${lon.toFixed(4)}`);
		q.set('fl', 'Your location');
		q.delete('in');
		const via = p.get('via');
		if (via && trip) {
			const t = trip;
			const ahead = via
				.split(';')
				.filter((v) => {
					const [vl, vo] = v.split(',').map(Number);
					return projectOnRoute({ lat: vl, lon: vo }, t.route, cum).along > lastProgress;
				})
				.join(';');
			if (ahead) q.set('via', ahead);
			else q.delete('via');
		}
		replanned = true;
		timedFromHere = false;
		if (speak && 'speechSynthesis' in window)
			speechSynthesis.speak(
				new SpeechSynthesisUtterance('You left the planned route. Planning again from here.')
			);
		void goto(`/trip?${q}`, { replace: true, reset: false });
	}

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
		offSince = null;
		timedFromHere = false;
		gpsLost = false;
		if (watchId !== null) navigator.geolocation.clearWatch(watchId);
		watchId = null;
		void wakeLock?.release().catch(() => {});
		wakeLock = null;
	}

	let lastPos: { lat: number; lon: number } | null = null;

	/** Where you are against the planned route: progress, off the route, and planning again when needed. */
	function onPosition(lat: number, lon: number) {
		lastPos = { lat, lon };
		if (!trip) return;
		const p = projectOnRoute({ lat, lon }, trip.route, cum);
		gpsLost = false;
		offRoute = p.off > 1;
		progress = offRoute ? null : p.along;
		if (progress !== null) {
			lastProgress = progress;
			offSince = null;
			// The first fix on the route: time the weather and warnings from here.
			if (!timedFromHere) {
				timedFromHere = true;
				void refresh();
			}
		} else if (offRoute) {
			offSince ??= Date.now();
			if (Date.now() - offSince > 60_000 && Date.now() - lastReplan > 180_000) replan(lat, lon);
		}
	}

	async function startFollowing() {
		gpsError = '';
		if (!navigator.geolocation) {
			gpsError = 'Location is not available on this device.';
			return;
		}
		following = true;
		sayVerdict = true;
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
			(pos) => onPosition(pos.coords.latitude, pos.coords.longitude),
			(err) => {
				// Only a refusal stops following. A lost signal (tunnels, snow sheds, canyons) is normal on a drive.
				if (err.code === err.PERMISSION_DENIED) {
					gpsError = 'Could not get your location. Check that location is allowed for this site.';
					stopFollowing();
				} else gpsLost = true;
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
	const stillAhead = (along: number) => progress === null || along >= progress - 0.5;
	const roadNow = $derived(
		trip
			? {
					...trip.road,
					passes: (live?.passes ?? trip.road.passes).filter((x) => stillAhead(x.along))
				}
			: null
	);
	const warningsNow = $derived.by((): RoadWarnings | null => {
		const w = live?.warnings;
		if (!w) return null;
		return {
			...w,
			closures: w.closures.filter((c) => stillAhead(c.along)),
			chainControls: w.chainControls.filter((c) => stillAhead(c.along)),
			alerts: w.alerts.filter((a) => stillAhead(a.toMile)),
			surface: w.surface.filter((x) => stillAhead(x.along))
		};
	});
	const weatherNow = $derived(
		live?.onTheWay
			? {
					...live.onTheWay,
					stops: live.onTheWay.stops.filter((x) => x.kind === 'end' || stillAhead(x.along))
				}
			: null
	);

	// The answer at a glance, from the freshest of everything the page has.
	const verdict = $derived.by(() => {
		if (!trip || !roadNow) return null;
		const stops = (weatherNow ?? firstWeather)?.stops ?? null;
		const asOf = live?.at ?? Date.now();
		return driveVerdict({
			avoided: trip.road.avoided,
			blocked: trip.road.blocked,
			passes: roadNow.passes,
			warnings: warningsNow ?? firstWarnings,
			weather: stops,
			vehicle,
			clock: (st) => localClock(asOf + st.minutesIn * 60_000, timeZoneAt(st.lat, st.lon))
		});
	});
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
			{#if verdict}
				<VerdictCard {verdict}>
					{#if trip.road.passes.length}
						<p class="verdict-for">Chains for what you're driving:</p>
						<VehiclePicker bind:vehicle />
					{/if}
				</VerdictCard>
			{/if}
			<div class="reverse page-actions">
				<ShareButton
					path="/trip?{tripShareParams(page.url.searchParams)}"
					title="{trip.from} to {trip.to}"
					text={verdict
						? `${trip.from} to ${trip.to}: ${verdict.title.toLowerCase()}. ${verdict.sentence}`
						: `Driving ${trip.from} to ${trip.to}: cameras, weather and passes on the way`}
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
					<p class="sub follow-why">
						Driving now? Follow to get times from where you are, changes read aloud, and the screen
						kept on.
					</p>
				{:else}
					<button class="secondary" onclick={stopFollowing}>Stop following</button>
					<label class="speak-toggle"
						><input type="checkbox" bind:checked={speak} onchange={saveSpeak} /> Read changes aloud</label
					>
				{/if}
			</div>
			<p class="live-line">
				{#if refreshing}Updating…{:else if refreshFailed}Couldn't update just now; trying again in a
					few minutes.{:else if updatedAt}Reports and weather as of {clock(updatedAt)}, updated
					every 5 minutes.{/if}
				<button type="button" class="linkish" onclick={refresh} disabled={refreshing}
					>Update now</button
				>
			</p>
			{#if gpsError}<p class="error">{gpsError}</p>{/if}
			{#if following && gpsLost}<p class="sub">
					No location signal right now. Still following.
				</p>{/if}
			{#if following && progress === null && !offRoute && !gpsError}
				<p class="sub">Finding your position…</p>
			{/if}
			{#if offRoute}
				<p class="notice">
					You're off the planned route. If you stay off it for a minute, the drive is planned again
					from where you are.
				</p>
			{:else if replanned && following}
				<p class="notice">Planned again from where you are.</p>
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

		{#if changes}
			<section class="trip-changes" aria-live="polite" aria-label="What changed on the road ahead">
				<h2>Changed at {clock(changes.at)}</h2>
				<ul>
					{#each changes.list as c, i (i)}<li class="tc-{c.tone}">{c.text}</li>{/each}
				</ul>
				<button type="button" class="secondary" onclick={() => (changes = null)}>OK</button>
			</section>
		{/if}

		<details class="trip-details">
			<summary>Road, chains and weather details</summary>
			<RoadAhead
				road={roadNow ?? trip.road}
				warnings={warningsNow ?? trip.warnings}
				bind:vehicle
				picker={false}
			/>

			{#if live}
				{#if live.snow}<SnowLine
						snow={live.snow}
						demo={trip.demoWinter}
						miles={trip.miles}
						minutes={trip.minutes}
						stops={trip.stops}
					/>{/if}
				{#if weatherNow}<RouteWeather weather={weatherNow} asOf={live.at} />{/if}
				<ConditionsBar conditions={live.conditions} mode="trip" />
			{:else}
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
			{/if}
		</details>

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
