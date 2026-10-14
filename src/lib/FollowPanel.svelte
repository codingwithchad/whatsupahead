<script lang="ts">
	import CameraMedia from './CameraMedia.svelte';
	import StatusPill from './StatusPill.svelte';
	import type { PassReport } from './passes';
	import type { StopWeather } from './routeWeather';
	import type { Camera } from './types';
	import type { Verdict } from './verdict';
	import { NEED_TONE, passAnswer, type Vehicle } from './vehicle';

	// Follow mode, for the passenger in a moving car: big text and big buttons, and only what matters next (the
	// next pass, its camera and the conditions there). Never a sponsor or a promotion here, whatever else the
	// site ever carries: this screen is read on the road.
	let {
		verdict,
		pass,
		milesTo,
		eta,
		weather,
		camera,
		next,
		vehicle,
		onstop
	}: {
		verdict: Verdict | null;
		pass: { name: string; report: PassReport | null; heading: number | null } | null;
		milesTo: number | null;
		/** "1:58 PM" at the pass. */
		eta: string | null;
		/** The forecast at the pass for when you get there. */
		weather: StopWeather | undefined;
		/** The camera nearest the summit, still ahead. */
		camera: Camera | undefined;
		/** With no pass ahead: the next camera and how far. */
		next: { camera: Camera; miles: number } | null;
		vehicle: Vehicle | null;
		onstop: () => void;
	} = $props();

	const KEY = 'follow-passenger-seen';
	let seen = $state(true);
	$effect(() => {
		try {
			seen = localStorage.getItem(KEY) === '1';
		} catch {
			seen = false;
		}
	});
	function gotIt() {
		seen = true;
		try {
			localStorage.setItem(KEY, '1');
		} catch {
			// remembering is optional
		}
	}

	const answer = $derived(
		pass?.report
			? vehicle
				? (() => {
						const a = passAnswer(pass.report, vehicle, pass.heading);
						return { tone: NEED_TONE[a.need], text: a.text };
					})()
				: { tone: pass.report.status, text: pass.report.label }
			: { tone: 'off-season' as const, text: 'No report right now' }
	);
	const shown = $derived(camera ?? next?.camera);
</script>

<section class="follow" aria-label="Following this drive">
	{#if !seen}
		<p class="follow-warn">
			For the passenger. Driver, eyes on the road.
			<button type="button" onclick={gotIt}>OK</button>
		</p>
	{/if}

	{#if verdict}
		<p class="follow-verdict follow-{verdict.level}">
			<strong>{verdict.title}</strong>
			<span>{verdict.sentence}</span>
		</p>
	{/if}

	{#if pass}
		<h2 class="follow-pass">{pass.name}</h2>
		<p class="follow-when">
			{[milesTo !== null ? `${milesTo.toFixed(0)} mi` : '', eta ? `about ${eta}` : '']
				.filter(Boolean)
				.join(' · ')}
		</p>
		<p class="follow-status"><StatusPill tone={answer.tone} label={answer.text} /></p>
		{#if weather}
			<p class="follow-weather">
				{weather.tempF !== null ? `${weather.tempF}°F` : ''}
				{weather.phrase}{weather.hazards.length ? ` · ${weather.hazards[0]}` : ''}
			</p>
		{/if}
	{:else if next}
		<h2 class="follow-pass">{next.camera.name}</h2>
		<p class="follow-when">{next.miles.toFixed(1)} mi · no more passes on this drive</p>
	{:else}
		<h2 class="follow-pass">No more passes or cameras ahead</h2>
	{/if}

	{#if shown}
		<div class="follow-camera">
			{#key shown.id}<CameraMedia camera={shown} large />{/key}
			<p class="follow-camera-name">{shown.name} · {shown.attribution_text ?? shown.source}</p>
		</div>
	{/if}

	<button type="button" class="follow-end" onclick={onstop}>■ Stop following</button>
</section>
