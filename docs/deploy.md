# Deploying to Render

The app is a single Node server (`node build`). `render.yaml` describes it.

1. In Render, choose New > Blueprint and connect the `codingwithchad/whatsupahead` GitHub repo.
2. When asked for `WSDOT_CODE`, paste your WSDOT access code (never commit it).
3. Render builds and gives you an https URL. Camera and data changes go live when you push to `main`.

Notes
- The free plan sleeps when idle and takes about a minute to wake. Switch the service to the Starter plan to keep it always on.
- Health check: `/healthz` reports how many cameras, weather sources and places loaded.
- Installable offline mode only works over https, so test it on the Render URL.

## Using your own domain (for example whatsupahead.com)

1. Buy the domain at a registrar (Cloudflare Registrar, Porkbun and Namecheap sell .com at or near cost).
2. In Render, open the service, then Settings, then Custom Domains. Add the root domain (`whatsupahead.com`) and `www.whatsupahead.com`. Render shows the exact DNS records to create; add them at the registrar (if you use Cloudflare, keep the records "DNS only", not proxied, until Render says the certificate is ready).
3. When Render shows the domain as verified with HTTPS, add the environment variable `CANONICAL_HOST=whatsupahead.com`. From then on any other address (the old `onrender.com` address, or `www.`) forwards there with a permanent redirect, so old links keep working. Set it only after step 2 works, or the site will forward visitors to an address that isn't ready.
4. Update the project identification on the Windy API key page to the new address.

## Azure App Service

The app also runs on Azure App Service (Linux, Node 24, always on), at https://whatsupahead.azurewebsites.net while it is tested.

- **Deploy:** `scripts/deploy-azure.sh` builds the current commit (the tree must be clean), uploads it and waits until `/healthz` reports that commit under `version`, so a deploy only counts once the new build is actually answering. It keeps the last 5 packages.
- **Roll back:** `scripts/deploy-azure.sh --list`, then `scripts/deploy-azure.sh --rollback <commit>`.
- **Keys:** `scripts/azure-set-key.sh NAME` copies a key from `.env` into the app's settings (or `NAME -` to paste it), without the value appearing in a command line or log. Changing a setting restarts the app.
- **Vault:** `scripts/azure-keys-to-vault.sh` copies the keys from `.env` into the app's Key Vault and turns the app settings into Key Vault references (read by the app's own identity, with read-only access), then reports whether each one resolves. It needs Key Vault Secrets Officer or Administrator on the vault. Key reads are logged to the shared log workspace.
- The scripts need `az login` and `AZURE_SUBSCRIPTION` in `.env`; they never use az's cached default subscription.
- Settings that differ from Render: `TRUSTED_PROXIES=1` (Azure adds one forwarding entry, with a port), `STATS_FILE=/home/data/stats.json` (the `/home` disk survives restarts and redeploys), `AZURE_MAPS_KEY` for routes and place search.
- Password-based deploys (FTP and SCM basic auth) are off; deploys use your Azure sign-in.
