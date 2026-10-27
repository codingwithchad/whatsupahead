// Read the live site's /healthz and say what needs attention. Used by .github/workflows/health.yml.
// Usage: node scripts/check-health.mjs [https://whatsupahead.com]
// Prints a Markdown list of problems and exits 1 when there are any, 0 when everything is fine.
const site = process.argv[2] ?? 'https://whatsupahead.com';
const TOKEN_WARN_DAYS = 14;

async function read() {
	const res = await fetch(`${site}/healthz`, { signal: AbortSignal.timeout(90_000) });
	if (!res.ok) throw new Error(`/healthz answered ${res.status}`);
	return res.json();
}

let health;
try {
	// The free host sleeps when idle: the first request wakes it, and its checks run about 5 seconds after
	// start (failures are retried 20 seconds later). Read again after two minutes.
	health = await read();
	if (Object.values(health.sources ?? {}).some((s) => s.status === 'unknown')) {
		await new Promise((r) => setTimeout(r, 120_000));
		health = await read();
	}
} catch (err) {
	console.log(`- **The site itself is not answering**: ${err.message}`);
	process.exit(1);
}

const problems = [];
for (const [name, s] of Object.entries(health.sources ?? {})) {
	if (s.status === 'failing' && s.failures_in_a_row >= 2)
		problems.push(
			`- **${name}** is failing (${s.problem ?? 'no answer'}), last worked ${s.last_ok ?? 'not since the server started'}`
		);
}
if (health.sources?.['facebook-posts']?.status === 'failing')
	problems.push(
		"- **To renew the Facebook Page key:** in Meta's Graph API Explorer pick our app and the Page and get a Page token, make it long-lived in the Access Token Debugger (Extend), add it to the Key Vault as facebook-page-token, then run ops/vault-sync.sh."
	);
const days = health.github_token_expires_in_days;
if (typeof days === 'number' && days <= TOKEN_WARN_DAYS)
	problems.push(
		`- **The GitHub token for the Add a camera form expires in ${days} days.** Make a new one (GitHub, Settings, Developer settings, Fine-grained tokens; Issues read and write on this repository only) and add it to the Key Vault as github-issues-token, then run ops/vault-sync.sh.`
	);

if (problems.length) {
	console.log(problems.join('\n'));
	process.exit(1);
}
console.log('All sources are working.');
