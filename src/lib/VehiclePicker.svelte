<script lang="ts">
	import { track } from './track';
	import { VEHICLES, saveVehicle, type Vehicle } from './vehicle';

	let { vehicle = $bindable() }: { vehicle: Vehicle | null } = $props();
</script>

<div class="chips vehicle-chips" role="group" aria-label="What are you driving?">
	{#each VEHICLES as v (v.id)}
		<button
			type="button"
			class="chip"
			aria-pressed={vehicle === v.id}
			onclick={() => {
				vehicle = v.id;
				saveVehicle(v.id);
				track('vehicle');
			}}>{v.label}</button
		>
	{/each}
</div>
