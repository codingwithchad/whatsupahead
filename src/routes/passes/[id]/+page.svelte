<script lang="ts">
	import PlaceBody from '../../../lib/PlaceBody.svelte';
	import SearchBox from '../../../lib/SearchBox.svelte';
	import ShareButton from '../../../lib/ShareButton.svelte';
	import StatusPill from '../../../lib/StatusPill.svelte';
	import { ago, localClock } from '../../../lib/format';
	import { rememberPlace } from '../../../lib/lastPlace';
	import { rememberRecent } from '../../../lib/recents';
	import { timeZoneAt } from '../../../lib/regions';
	import { NEED_TONE, passAnswer, VEHICLES } from '../../../lib/vehicle';
	import { passVerdict } from '../../../lib/verdict';
	import VerdictCard from '../../../lib/VerdictCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const pass = $derived(data.pass);
	const report = $derived(data.report);
	const base = $derived(`/passes/${encodeURIComponent(pass.id)}`);
	$effect(() => {
		rememberPlace(location.pathname + location.search);
		if (data.placeId) rememberRecent({ kind: 'place', id: data.placeId });
	});

	const STATE_PAGE: Record<string, { label: string; url: string }> = {
		WSDOT: { label: "WSDOT's pass page", url: 'https://wsdot.com/travel/real-time/mountainpasses' },
		ODOT: { label: 'TripCheck', url: 'https://tripcheck.com/' },
		Caltrans: { label: 'QuickMap', url: 'https://quickmap.dot.ca.gov/' }
	};
	const statePage = $derived(pass.link ?? STATE_PAGE[pass.source]);
	const verdict = $derived(passVerdict({ name: pass.name, report }));
	const reporting = $derived(report !== null && report.status !== 'off-season');
	const updated = $derived(
		report?.updated ? `updated ${ago(new Date(report.updated).toISOString())}` : ''
	);
	const lines = $derived(
		(report?.restrictions ?? []).filter((r) => r.text.trim() && !/^no restrictions/i.test(r.text))
	);
	const radii = [5, 10, 25, 50];
	// "Oct 12" from "2026-10-12".
	const shortDay = (day: string) =>
		new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
			new Date(`${day}T12:00:00Z`)
		);
	const DAY_WORDS: Record<string, string> = {
		closed: 'closed',
		chains: 'chains required',
		traction: 'traction tires',
		open: 'open, no restrictions',
		none: 'no report'
	};
	const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
	const tz = $derived(data.place ? timeZoneAt(data.place.lat, data.place.lon) : undefined);
	const openAlternates = $derived(
		data.alternates.filter((a) => a.report && a.report.status !== 'closed')
	);
	const names = (list: string[]) =>
		list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : list[0];
	const isOpenAnswer = $derived.by(() => {
		if (!report || report.status === 'off-season')
			return `There is no official report for ${pass.name} right now${pass.winter_closure ? ` (${pass.winter_closure.toLowerCase()})` : ''}. Look at the cameras on this page, and check ${statePage.label} before you go.`;
		if (report.status === 'closed')
			return `No. ${pass.source} reports it closed${updated ? ` (${updated})` : ''}.${report.road ? ` ${report.road}` : ''}`;
		return `Yes. ${pass.source} reports: ${report.label}${updated ? ` (${updated})` : ''}.`;
	});
</script>

<svelte:head>
	<title>{data.pageTitle}</title>
</svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<SearchBox value="" />
</header>

<main>
	<section class="summary">
		<h1>{pass.name} conditions</h1>
		<p class="sub">
			{[
				pass.route,
				pass.elevation_ft ? `${pass.elevation_ft.toLocaleString()} ft` : null,
				pass.connects
			]
				.filter(Boolean)
				.join(' · ')}
		</p>
		<div class="page-actions">
			<ShareButton
				path={base}
				title="{pass.name} conditions"
				text="{pass.name} right now: cameras, chains and weather"
			/>
		</div>
	</section>

	<VerdictCard {verdict} />

	<section class="pass-now" aria-label="{pass.name} right now">
		<div class="pass-now-top">
			<small
				>{reporting
					? `${pass.source} report${updated ? `, ${updated}` : ''}`
					: `No ${pass.source} report right now`}</small
			>
		</div>
		{#if report?.status === 'closed'}
			<p class="ra-alert ra-danger">
				<strong>{pass.name} is closed.</strong>
				{#if openAlternates.length}Other ways across: {names(
						openAlternates.map((a) => `${a.name} (${a.route})`)
					)}.{/if}
				Don't follow a phone map's detour onto side roads: they aren't plowed.
			</p>
		{/if}
		{#if reporting}
			{#each lines as r (r.direction + r.text)}
				<p class="pass-line"><strong>{r.direction || 'Restriction'}:</strong> {r.text}</p>
			{/each}
			{#if report?.road}<p class="pass-line">{report.road}</p>{/if}
			{#if report?.weather || report?.tempF !== null}
				<p class="pass-line">
					{[
						report?.tempF !== null ? `${Math.round(report?.tempF ?? 0)}°F` : null,
						report?.weather || null
					]
						.filter(Boolean)
						.join(' · ')}
				</p>
			{/if}
		{/if}
		{#if pass.winter_closure}<p class="pass-line">{pass.winter_closure}.</p>{/if}

		{#if reporting}
			<h2>Chains today</h2>
			<ul class="chains-today">
				{#each VEHICLES as v (v.id)}
					{@const a = passAnswer(report, v.id)}
					<li>
						<span>{v.label}</span>
						<StatusPill tone={NEED_TONE[a.need]} label={a.text} />
					</li>
				{/each}
			</ul>
			<p class="ra-note">
				<a href="/tires">What's a traction tire?</a>
				{lines.length > 1 ? 'The stricter direction. ' : ''}Our reading of the state's rule. Signs
				on the road always come first.
				<a href={statePage.url} target="_blank" rel="noopener">{statePage.label}</a>
			</p>
		{:else}
			<p class="pass-line">
				{pass.source === 'WSDOT'
					? 'WSDOT writes pass reports in the snow season, usually November to April. Until then, look at the cameras below.'
					: 'No chain controls or crew report for this pass right now. Look at the cameras below.'}
				<a href={statePage.url} target="_blank" rel="noopener">{statePage.label}</a>
			</p>
		{/if}
	</section>

	{#if data.season}
		{@const s = data.season}
		<section class="pass-season" aria-label="This season">
			<h2>This season</h2>
			{#if s.reported}
				<p>
					Since we started on {shortDay(s.since)}: chains required on
					<strong>{days(s.chains)}</strong>, closed on
					<strong>{days(s.closed)}</strong>, traction tires on {days(s.traction)}.{s.lastChains
						? ` Last chains: ${shortDay(s.lastChains)}.`
						: ''}{s.lastClosed ? ` Last closed: ${shortDay(s.lastClosed)}.` : ''}
				</p>
			{:else}
				<p>
					No reports yet this season. We note the report every 10 minutes from {shortDay(s.since)} on,
					so this will show how often {pass.name} needs chains.
				</p>
			{/if}
			<ol class="season-strip" aria-label="The last 30 days">
				{#each s.recent as d (d.day)}
					<li
						class="day-{d.status ?? 'untracked'}"
						title="{shortDay(d.day)}: {d.status ? DAY_WORDS[d.status] : 'not tracked yet'}"
					></li>
				{/each}
			</ol>
			<p class="ra-note">
				The last 30 days, worst report of each day:
				{#each [['closed', 'closed'], ['chains', 'chains'], ['traction', 'traction tires'], ['open', 'open'], ['none', 'no report']] as [k, label] (k)}
					<span class="key-item"><span class="key day-{k}"></span> {label}</span>
				{/each}
			</p>
		</section>
	{/if}

	<div class="mountain-cards">
		{#await data.snow then snow}
			{#if snow}
				<section class="mountain-card" aria-label="Snow on the ground">
					<h2>Snow on the ground</h2>
					<p class="mountain-big">
						{snow.depthIn < 2 ? 'Bare (under 2 in)' : `${snow.depthIn} in`}
					</p>
					{#if snow.change24 !== null && Math.abs(snow.change24) >= 2}
						<p class="mountain-sub">
							{snow.change24 > 0 ? `+${snow.change24}` : snow.change24} in in 24 hours
						</p>
					{/if}
					<p class="mountain-src">
						<a href={snow.link} target="_blank" rel="noopener">{snow.station}</a> snow station, {snow.elevation_ft.toLocaleString()}
						ft, {snow.miles.toFixed(0)} mi away · {localClock(snow.at, tz)}{snow.tempF !== null
							? ` · ${Math.round(snow.tempF)}°F`
							: ''}
					</p>
				</section>
			{/if}
		{/await}
		{#await data.avalanche then avy}
			{#if avy}
				<section class="mountain-card" aria-label="Avalanche danger">
					<h2>Avalanche danger</h2>
					<p class="mountain-big avy-{avy.level ?? 0}">
						{avy.level ? `${avy.danger} (${avy.level} of 5)` : 'No rating today'}
					</p>
					<p class="mountain-src">
						For the backcountry around the pass, from <a
							href={avy.link}
							target="_blank"
							rel="noopener">{avy.center}</a
						>
						({avy.zone}). The state closes the highway itself for avalanche control.
					</p>
				</section>
			{/if}
		{/await}
	</div>

	<nav class="radius" aria-label="Camera radius">
		{#each radii as r (r)}
			<a href="{base}?r={r}" aria-current={r === data.radius ? 'true' : undefined}>{r} mi</a>
		{/each}
	</nav>
	<PlaceBody {data} {base} />

	{#await data.checkpoints then checkpoints}
		{#if checkpoints?.length}
			{@const active = checkpoints.filter((c) => c.level !== 'R-0')}
			<section class="pass-alternates" aria-label="Chain control checkpoints">
				<h2>Chain control checkpoints</h2>
				<p class="pass-line">
					{active.length
						? `Chain controls at ${active.length} of ${checkpoints.length} checkpoints on ${pass.route} near the pass.`
						: `No chain controls at any of the ${checkpoints.length} checkpoints on ${pass.route} near the pass.`}
					Put chains on in a chain installation area before a checkpoint, never in a traffic lane.
				</p>
				{#snippet list(items: typeof checkpoints)}
					<ul class="ra-passes">
						{#each items as c (`${c.name}|${c.direction}|${c.lat}|${c.lon}`)}
							<li>
								<span class="ra-pass-top">
									<span class="place-name">{c.name}</span>
									<StatusPill
										tone={c.level === 'R-0' ? 'open' : 'chains'}
										label={c.level === 'R-0' ? 'No chain controls' : `${c.level}: ${c.text}`}
									/>
								</span>
								<small class="ra-pass-sub"
									>{c.direction ? `${c.direction}bound` : ''}{c.elevation_ft
										? ` · ${c.elevation_ft.toLocaleString()} ft`
										: ''} · {(c.km * 0.621).toFixed(0)} mi from the summit</small
								>
							</li>
						{/each}
					</ul>
				{/snippet}
				{#if active.length}{@render list(active)}{/if}
				<details class="checkpoint-all">
					<summary>Every checkpoint ({checkpoints.length})</summary>
					{@render list(checkpoints)}
				</details>
			</section>
		{/if}
	{/await}

	{#if data.alternates.length}
		<section class="pass-alternates">
			<h2>If {pass.name} closes</h2>
			<ul class="ra-passes">
				{#each data.alternates as a (a.id)}
					<li>
						<span class="ra-pass-top">
							<a href="/passes/{encodeURIComponent(a.id)}">{a.name}</a>
							{#if a.report}<StatusPill tone={a.report.status} label={a.report.label} />{/if}
						</span>
						<small class="ra-pass-sub">{a.route} · {a.miles.toFixed(0)} mi away</small>
					</li>
				{/each}
			</ul>
			<p class="ra-note">
				<a href="/trip">Plan a drive</a>: when a pass on the way is closed, the drive goes over an
				open one instead and says so.
			</p>
		</section>
	{/if}

	<section class="pass-faq">
		<h2>Questions</h2>
		<h3>Is {pass.name} open right now?</h3>
		<p>{isOpenAnswer}</p>
		<h3>Do I need chains on {pass.name}?</h3>
		<p>
			{#if reporting}
				Today: {VEHICLES.map(
					(v) => `${v.label.toLowerCase()}: ${passAnswer(report, v.id).text.toLowerCase()}`
				).join('; ')}. Rules change with the weather, often within an hour, so look again before you
				leave.
			{:else}
				There is no requirement reported right now. In the snow season, the rule can change within
				an hour: check this page before you leave, and carry chains over the mountains in winter.
			{/if}
		</p>
		{#if pass.elevation_ft}
			<h3>How high is {pass.name}?</h3>
			<p>
				{pass.elevation_ft.toLocaleString()} feet, on {pass.route}{pass.connects
					? `, connecting ${pass.connects}`
					: ''}.
			</p>
		{/if}
		{#if data.alternates.length}
			<h3>What if {pass.name} closes?</h3>
			<p>
				The nearest other ways across are {names(
					data.alternates.map((a) => `${a.name} (${a.route})`)
				)}. Check their status above before you change your plans: storms often close more than one.
			</p>
		{/if}
	</section>
</main>
