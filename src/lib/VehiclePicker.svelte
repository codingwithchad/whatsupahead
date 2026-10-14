<script lang="ts">
	import { track } from './track';
	import { VEHICLES, saveVehicle, type Vehicle } from './vehicle';

	let { vehicle = $bindable(), label = '' }: { vehicle: Vehicle | null; label?: string } = $props();
</script>

<div class="chips vehicle-chips" role="group" aria-label="What are you driving?">
	{#if label}<span class="vehicle-label">{label}</span>{/if}
	{#each VEHICLES as v (v.id)}
		<button
			type="button"
			class="chip"
			aria-pressed={vehicle === v.id}
			onclick={() => {
				vehicle = v.id;
				saveVehicle(v.id);
				track('vehicle');
			}}
			title={v.label}
			>{#if vehicle === v.id}<span aria-hidden="true">✓ </span>{/if}{v.pick}</button
		>
	{/each}
</div>
