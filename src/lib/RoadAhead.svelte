<script lang="ts">
	import StatusPill from './StatusPill.svelte';
	import VehiclePicker from './VehiclePicker.svelte';
	import { ago, duration, localClock } from './format';
	import { timeZoneAt } from './regions';
	import {
		forDirection,
		loadVehicle,
		NEED_TONE,
		passAnswer,
		VEHICLES,
		type Vehicle
	} from './vehicle';
	import type { PassReport } from './passes';
	import type { RoadWarnings } from './roadAhead';

	interface RoadPass {
		id: string;
		name: string;
		route: string;
		place: string;
		link: { label: string; url: string } | null;
		source: string;
		along: number;
		heading: number | null;
		report: PassReport | null;
	}
	let {
		road,
		warnings
	}: {
		road: {
			avoided: { closed: string; instead: string; extraMinutes: number }[];
			blocked: string[];
			roughMiles: number;
			passes: RoadPass[];
		};
		warnings: Promise<RoadWarnings>;
	} = $props();

	let vehicle = $state<Vehicle | null>(null);
	$effect(() => {
		vehicle = loadVehicle();
	});
	const short = $derived(VEHICLES.find((v) => v.id === vehicle)?.short ?? '');

	const STATE_PAGE: Record<string, { label: string; url: string }> = {
		WSDOT: { label: "WSDOT's pass page", url: 'https://wsdot.com/travel/real-time/mountainpasses' },
		ODOT: { label: 'TripCheck', url: 'https://tripcheck.com/' },
		Caltrans: { label: 'QuickMap', url: 'https://quickmap.dot.ca.gov/' }
	};
	const statePage = (p: RoadPass) => p.link ?? STATE_PAGE[p.source];
	const names = (list: string[]) =>
		list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];

	// "until 10 AM", or "until Tue 10 AM" when it runs past tomorrow morning.
	const until = (ms: number, at: { lat: number; lon: number }) => {
		const tz = timeZoneAt(at.lat, at.lon);
		const day =
			ms - Date.now() > 18 * 3600_000
				? `${new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(ms)} `
				: '';
		return `until ${day}${localClock(ms, tz)}`;
	};
	const forecastLink = (p: { lat: number; lon: number }) =>
		`https://forecast.weather.gov/MapClick.php?lat=${p.lat.toFixed(3)}&lon=${p.lon.toFixed(3)}`;
	const stretch = (from: number, to: number) =>
		to - from < 2
			? `at mile ${Math.round(from)}`
			: `miles ${Math.round(from)} to ${Math.round(to)}`;
	const updated = (ms: number | null) => (ms ? `updated ${ago(new Date(ms).toISOString())}` : '');
	const anyClosed = (w: RoadWarnings | null) =>
		road.avoided.length > 0 || road.blocked.length > 0 || (w?.closures.length ?? 0) > 0;
</script>

{#snippet detour()}
	<p class="ra-detour">
		If a road closes, wait, or take the detour the state posts. Don't follow a phone map's detour
		onto side roads or forest roads: they aren't plowed, and drivers get stranded on them every
		winter.
	</p>
{/snippet}

<section class="road-ahead" aria-label="Road ahead: closures, chains and weather warnings">
	<h2>Road ahead</h2>

	{#each road.avoided as a (a.closed)}
		<p class="ra-alert ra-caution">
			<strong>{a.closed} is closed.</strong> This drive goes over {a.instead} instead{a.extraMinutes >=
			5
				? `, about ${duration(a.extraMinutes)} longer`
				: ''}.
		</p>
	{/each}
	{#if road.blocked.length}
		<p class="ra-alert ra-danger">
			<strong
				>{names(road.blocked)}
				{road.blocked.length > 1 ? 'are' : 'is'} closed, and we found no open way around.</strong
			>
			Wait for it to open before you set out.
		</p>
	{/if}

	{#await warnings}
		{#if anyClosed(null)}{@render detour()}{/if}
		<p class="ra-checking">Checking closures and weather warnings on the way…</p>
	{:then w}
		{#each w.closures as c, i (i)}
			<p class="ra-alert ra-danger">
				<strong>Closed on your way</strong>
				<small>(mile {Math.round(c.along)})</small>: {c.headline}
				<small
					><a href={c.link} target="_blank" rel="noopener">{c.source}</a>{c.updated
						? `, ${updated(c.updated)}`
						: ''}</small
				>
			</p>
		{/each}
		{#each w.alerts as a (a.event)}
			<p class="ra-alert ra-{a.tone}">
				<strong>{a.event}</strong>
				{a.near ? `near ${a.near}` : ''}
				<small>({stretch(a.fromMile, a.toMile)})</small>, in effect when you get there at
				{localClock(a.reach, timeZoneAt(a.at.lat, a.at.lon))}{a.ends
					? `, ${until(a.ends, a.at)}`
					: ''}.
				<a href={forecastLink(a.at)} target="_blank" rel="noopener">Details</a>
			</p>
		{/each}
		{#if anyClosed(w)}{@render detour()}{/if}
		{#if !anyClosed(w) && !w.alerts.length}
			<p class="ra-clear">
				{w.unchecked.length
					? 'No closures or weather warnings found in what we could check.'
					: 'No closures or weather warnings on your way right now.'}
			</p>
		{/if}
		{#if w.unchecked.length}
			<p class="ra-note">
				Couldn't check {names(w.unchecked)} just now. Look at the state's map before you go.
			</p>
		{/if}
	{:catch}
		{#if anyClosed(null)}{@render detour()}{/if}
		<p class="ra-note">
			Couldn't check closures and weather warnings just now. Look at the state's map before you go.
		</p>
	{/await}

	{#if road.roughMiles >= 2}
		<p class="ra-alert ra-caution">
			<strong>About {road.roughMiles} miles of this drive is on slow back roads</strong> (dirt or forest
			roads). They are often not plowed in winter, and many have no cell signal.
		</p>
	{/if}

	{#if road.passes.length}
		<h3>Passes on the way</h3>
		<p class="ra-ask">What are you driving?</p>
		<VehiclePicker bind:vehicle />
		<ul class="ra-passes">
			{#each road.passes as p (p.id)}
				{@const answer = vehicle ? passAnswer(p.report, vehicle, p.heading) : null}
				{@const lines = p.report
					? forDirection(
							p.report.restrictions.filter((r) => !/^no restrictions/i.test(r.text)),
							p.heading
						)
					: []}
				<li>
					<span class="ra-pass-top">
						<a href="/search?place={encodeURIComponent(p.place)}">{p.name}</a>
						{#if answer}
							<StatusPill tone={NEED_TONE[answer.need]} label={answer.text} />
						{:else if p.report}
							<StatusPill tone={p.report.status} label={p.report.label} />
						{/if}
					</span>
					<small class="ra-pass-sub"
						>{p.route} · mile {Math.round(p.along)}{answer ? ` · for your ${short}` : ''}</small
					>
					{#each lines as r (r.direction + r.text)}
						<small class="ra-line">{r.direction ? `${r.direction}: ` : ''}{r.text}</small>
					{/each}
					{#if p.report && p.report.status !== 'off-season'}
						<small class="ra-line"
							>{p.source} report{p.report.updated ? `, ${updated(p.report.updated)}` : ''}</small
						>
					{:else}
						<small class="ra-line"
							>{p.report ? '' : `No report from ${p.source} right now.`}
							<a href={statePage(p).url} target="_blank" rel="noopener"
								>Check {statePage(p).label}</a
							> before you go.</small
						>
					{/if}
				</li>
			{/each}
		</ul>
		{#if vehicle}
			<p class="ra-note">
				Our reading of the state's rule for your vehicle. The state's own words are under each pass,
				and signs on the road always come first.
			</p>
		{/if}
	{/if}

	<p class="ra-source">
		From WSDOT, ODOT and Caltrans road reports and National Weather Service warnings, for the time
		you reach each point.
	</p>
</section>
