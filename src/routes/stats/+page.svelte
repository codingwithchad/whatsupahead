<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	/** "Tue, Oct 13" for "2026-10-13". */
	const dayName = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
			timeZone: 'UTC',
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	const title = $derived(
		data.day === data.today
			? 'Today'
			: data.day === data.yesterday
				? 'Yesterday'
				: data.day
					? dayName(data.day)
					: `Last ${data.range} days`
	);
	/** "00" -> "12 AM", "13" -> "1 PM". */
	const hourName = (h: string) => {
		const n = Number(h);
		return `${n % 12 || 12} ${n < 12 ? 'AM' : 'PM'}`;
	};
	const hourly = $derived(data.picked.hourly ?? []);
	const mostPeople = $derived(Math.max(1, ...hourly.map((h) => h.people)));
	// Numbers on the three busiest hours only; tap any hour for its own.
	const busiest = $derived(
		new Set(
			[...hourly]
				.filter((h) => h.people > 0)
				.sort((a, b) => b.people - a.people)
				.slice(0, 3)
				.map((h) => h.hour)
		)
	);
	let tapped = $state<string | null>(null);
	const shownHour = $derived(hourly.find((h) => h.hour === tapped));
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
		'pass-way': 'Picked a way over a pass',
		'jump-to-pass': 'Jumped to a pass on a drive',
		'watch-live': 'Watch live (YouTube)',
		'follow-trip': 'Follow my trip',
		'reverse-trip': 'Reverse this drive',
		'way-around': 'Way around a closed road',
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
		Counts only: nothing about who anyone is, and no cookies (except the one below, on devices you
		ask not to count). Counting since {pacific(data.since)}. Days are Pacific time. Kept in {data.storage}{#if data.lastSave.at},
			last saved {pacific(data.lastSave.at)}{/if}.
	</p>
	{#if !data.lastSave.ok}
		<p class="place-note">
			The last save didn't go through ({data.lastSave.error}). Nothing is lost: the counts are kept
			and saved on the next try.
		</p>
	{/if}

	<section class="card stat-counting" aria-label="Counting this device">
		{#if data.counted}
			<p>This phone or browser is counted like any visitor.</p>
			<form method="POST" action="?/nocount" use:enhance>
				<button type="submit">Don't count this device</button>
			</form>
		{:else}
			<p>
				<strong>This phone or browser is not counted.</strong> Your own testing stays out of the numbers.
			</p>
			<form method="POST" action="?/count" use:enhance>
				<button type="submit" class="secondary">Count it again</button>
			</form>
		{/if}
	</section>

	<nav class="stat-range" aria-label="Which days">
		<a href="?day={data.today}" aria-current={data.day === data.today ? 'page' : undefined}>Today</a
		>
		<a href="?day={data.yesterday}" aria-current={data.day === data.yesterday ? 'page' : undefined}
			>Yesterday</a
		>
		<a href="?range=7" aria-current={data.range === 7 ? 'page' : undefined}>7 days</a>
		<a href="?range=30" aria-current={data.range === 30 ? 'page' : undefined}>30 days</a>
		<label>
			<span class="visually-hidden">Pick a day</span>
			<input
				type="date"
				min={data.oldest}
				max={data.today}
				value={data.day ?? ''}
				onchange={(e) => {
					const v = e.currentTarget.value;
					if (v) void goto(`?day=${v}`);
				}}
			/>
		</label>
	</nav>

	<h2>{title}: {data.picked.visitors} visitors · {data.picked.views} pages</h2>
	{#if data.range}<p class="sub">A person who came on two days counts on each.</p>{/if}

	<h3>When people came{data.range ? ` (all ${data.range} days together)` : ''}</h3>
	{#if data.picked.hourly}
		<div class="hours" role="group" aria-label="People arriving each hour, Pacific time">
			{#each hourly as h (h.hour)}
				<button
					type="button"
					class="hour"
					class:tapped={tapped === h.hour}
					aria-label="{hourName(h.hour)}: {h.people} people arrived, {h.pages} pages"
					title="{hourName(h.hour)}: {h.people} people, {h.pages} pages"
					onclick={() => (tapped = tapped === h.hour ? null : h.hour)}
				>
					<span class="hour-n">{busiest.has(h.hour) ? h.people : ''}</span>
					<span
						class="hour-bar"
						class:none={h.people === 0}
						style="height: {(h.people / mostPeople) * 100}%"
					></span>
				</button>
			{/each}
		</div>
		<div class="hour-axis" aria-hidden="true">
			<span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span>
		</div>
		<p class="hour-readout" aria-live="polite">
			{#if shownHour}
				<strong>{hourName(shownHour.hour)}</strong>: {shownHour.people}
				{shownHour.people === 1 ? 'person' : 'people'} arrived, {shownHour.pages} pages
			{:else}Tap an hour to see its numbers. Pacific time.{/if}
		</p>
		<details class="hour-table">
			<summary>As a table</summary>
			<table>
				<thead><tr><th>Hour</th><th>People arrived</th><th>Pages</th></tr></thead>
				<tbody>
					{#each hourly.filter((h) => h.people || h.pages) as h (h.hour)}
						<tr><td>{hourName(h.hour)}</td><td>{h.people}</td><td>{h.pages}</td></tr>
					{/each}
				</tbody>
			</table>
		</details>
	{:else}
		<p class="sub">Counted by the hour from October 14, 2026 on.</p>
	{/if}

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

	<h2>Facebook posts</h2>
	<p class="sub">
		{data.autopost.live
			? 'The Page posts by itself when a pass, ski area or park starts snowing (at most 3 a day).'
			: 'Dry run: no Facebook key yet, so these are what the Page would have posted.'}
	</p>
	{#if data.autopost.entries.length}
		<ul class="autopost-log">
			{#each data.autopost.entries as e (e.at)}
				<li>
					<strong
						>{new Date(e.at).toLocaleString('en-US', {
							timeZone: 'America/Los_Angeles',
							weekday: 'short',
							hour: 'numeric',
							minute: '2-digit'
						})}</strong
					>
					{e.dry ? '(would post)' : e.error ? `(failed: ${e.error})` : '(posted)'}
					{e.text}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">Nothing yet.</p>
	{/if}

	<p class="sub">
		Tip: end links you post with <code>?ref=fb</code>, <code>?ref=ig</code> or any short word (for
		example <code>whatsupahead.com/passes?ref=ig</code>). They show under "Came from other sites"
		even from apps that don't say where a visitor came from.
	</p>
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
		{@render table('Came from other sites', data.picked.sources)}
		{@render table('Pages', data.picked.pages)}
		{@render table('From the home page, people went to', data.picked.fromHome)}
		{@render table('Places and lists opened', data.picked.places)}
		{@render table(
			'Taps',
			data.picked.events.map(([k, n]) => [EVENT_NAMES[k] ?? k, n])
		)}
		{@render table('All moves between pages', data.picked.flows)}
		{@render table('Typed searches', [
			['Found a place', data.picked.searches.found],
			['Found nothing', data.picked.searches.notFound]
		])}
	</div>

	<h2>Day by day</h2>
	<ul class="bars">
		{#each data.daily as d (d.day)}
			<li>
				<a
					class="bar-day"
					href="?day={d.day}"
					aria-current={data.day === d.day ? 'page' : undefined}>{dayName(d.day)}</a
				>
				<span class="bar" style="width: {(d.visitors / most) * 100}%"></span>
				<span class="bar-n">{d.visitors} people · {d.views} pages</span>
			</li>
		{/each}
	</ul>
</main>
