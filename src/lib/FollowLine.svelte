<script lang="ts">
	import { FACEBOOK_URL } from './brand';
	import { track } from './track';
</script>

<p class="follow-line">
	Snow and chain news for this pass, as it happens:
	<a href={FACEBOOK_URL} target="_blank" rel="noopener" onclick={() => track('follow-facebook')}
		>follow us on Facebook</a
	>
</p>
