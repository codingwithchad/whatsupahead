<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const pacific = (iso: string) =>
		new Date(iso).toLocaleString('en-US', {
			timeZone: 'America/Los_Angeles',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	const most = $derived(Math.max(1, ...data.daily.map((d) => d.visitors)));
	const EVENT_NAMES: Record<string, string> = {
		'viewer-open': 'Opened the camera viewer',
		'viewer-next': 'Next / Previous in the viewer',
		'viewer-swipe': 'Swiped in the viewer',
		'watch-live': 'Watch live (YouTube)',
		'follow-trip': 'Follow my trip',
		'reverse-trip': 'Reverse this drive',
		'leave-later': 'Leave in 1–3 h',
		install: 'Install now',
		'use-location': 'Use my location',
		share: 'Share (tapped)',
		'share-sent': 'Shared from the phone menu',
		'share-copy': 'Copied a link',
		'share-facebook': 'Shared to Facebook',
		'share-text': 'Shared by text message',
		'moment-open': 'Opened before and after',
		vehicle: 'Picked a vehicle for chains',
		'moment-save': 'Saved a before-and-after picture',
		'replay-video': 'Made a replay video',
		'replay-video-share': 'Shared or saved a replay video'
	};
</script>

<svelte:head>
	<title>Stats · What's Up Ahead</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<header class="top">
	<a class="brand" href="/">What's Up Ahead</a>
	<span class="top-title">Stats</span>
</header>

<main class="stats">
	<h1>Visits</h1>
	<p class="sub">
		Counts only: no cookies, nothing about who anyone is. Counting since {pacific(data.since)}. Days
		are Pacific time. Kept in {data.storage}{#if data.lastSave.at}, last saved {pacific(
				data.lastSave.at
			)}{/if}.
	</p>
	{#if !data.lastSave.ok}
		<p class="place-note">
			The last save didn't go through ({data.lastSave.error}). Nothing is lost: the counts are kept
			and saved on the next try.
		</p>
	{/if}

	<h2>Different visitors per day</h2>
	<ul class="bars">
		{#each data.daily as d (d.day)}
			<li>
				<span class="bar-day">{d.day.slice(5)}</span>
				<span class="bar" style="width: {(d.visitors / most) * 100}%"></span>
				<span class="bar-n">{d.visitors} people · {d.views} pages</span>
			</li>
		{/each}
	</ul>

	{#if data.maps}
		<h2>Azure Maps this month</h2>
		<p class="sub">
			Requests counted against the free monthly amounts (UTC month). Past the limit, or a day's
			share of it, the free services take over.
		</p>
		<table class="maps-usage">
			<thead><tr><th>Kind</th><th>This month</th><th>Today</th><th>Limit</th></tr></thead>
			<tbody>
				{#each data.maps as m (m.kind)}
					<tr>
						<td
							>{m.kind === 'route'
								? 'Routes'
								: m.kind === 'search'
									? 'Searches'
									: 'Weather on the way'}</td
						>
						<td>{m.month}</td>
						<td>{m.today}</td>
						<td>{m.monthLimit} a month, {m.dayLimit} a day</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	<h2>Last 7 days: {data.week.visitors} visitors</h2>
	<div class="stat-grid">
		{#snippet table(title: string, rows: (string | number)[][], empty = 'Nothing yet')}
			<section class="card stat-card">
				<h3>{title}</h3>
				{#if rows.length}
					<table>
						<tbody>
							{#each rows as [name, n] (name)}
								<tr><td>{name}</td><td class="n">{n}</td></tr>
							{/each}
						</tbody>
					</table>
				{:else}<p class="sub">{empty}</p>{/if}
			</section>
		{/snippet}
		{@render table('Pages', data.week.pages)}
		{@render table('From the home page, people went to', data.week.fromHome)}
		{@render table('Places and lists opened', data.week.places)}
		{@render table(
			'Taps',
			data.week.events.map(([k, n]) => [EVENT_NAMES[k] ?? k, n])
		)}
		{@render table('Came from other sites', data.week.sources)}
		{@render table('All moves between pages', data.week.flows)}
		{@render table('Typed searches', [
			['Found a place', data.week.searches.found],
			['Found nothing', data.week.searches.notFound]
		])}
	</div>
</main>
