<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Area } from './areas';

	// Sort and Show for a long list (passes, ski areas), the same on each page. Show picks a state or a mountain
	// area and puts it in the address (`?in=sierra`), so the list you are looking at is the one you share. The sort
	// is remembered on this device under `storageKey`.
	let {
		sorts,
		sort = $bindable(),
		storageKey,
		areas,
		area,
		base
	}: {
		sorts: { id: string; label: string }[];
		sort: string;
		storageKey: string;
		areas: Area[];
		area: Area | null;
		/** The page's address without `?in=` */
		base: string;
	} = $props();

	$effect(() => {
		try {
			const saved = localStorage.getItem(storageKey);
			if (saved && sorts.some((s) => s.id === saved)) sort = saved;
		} catch {
			// remembering is optional
		}
	});
	function pick(id: string) {
		sort = id;
		try {
			localStorage.setItem(storageKey, id);
		} catch {
			// remembering is optional
		}
	}
	const states = $derived(areas.filter((a) => a.kind === 'state'));
	const mountains = $derived(areas.filter((a) => a.kind === 'mountains'));
	function show(e: Event) {
		const id = (e.currentTarget as HTMLSelectElement).value;
		void goto(id ? `${base}?in=${encodeURIComponent(id)}` : base, { reset: false });
	}
</script>

<div class="list-controls">
	<div class="list-row">
		<span class="list-label" id="{storageKey}-sort">Sort</span>
		<div class="chips" role="group" aria-labelledby="{storageKey}-sort">
			{#each sorts as s (s.id)}
				<button type="button" class="chip" aria-pressed={sort === s.id} onclick={() => pick(s.id)}
					>{s.label}</button
				>
			{/each}
		</div>
	</div>
	<form class="list-row" method="get" action={base}>
		<label class="list-label" for="{storageKey}-in">Show</label>
		<select id="{storageKey}-in" name="in" value={area?.id ?? ''} onchange={show}>
			<option value="">Everywhere</option>
			<optgroup label="States">
				{#each states as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
			</optgroup>
			{#if mountains.length}
				<optgroup label="Mountain areas">
					{#each mountains as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
				</optgroup>
			{/if}
		</select>
		<noscript><button type="submit" class="chip">Show</button></noscript>
	</form>
</div>
