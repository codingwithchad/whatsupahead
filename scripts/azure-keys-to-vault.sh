#!/usr/bin/env bash
# Move the app's API keys into its Key Vault, and point the app's settings at the vault.
#
#   scripts/azure-keys-to-vault.sh
#
# For each key: copies the value from .env into the vault (through a private temporary file, never a command
# line or the screen), then replaces the app setting with a Key Vault reference, which the app's own identity
# reads. Finally asks Azure whether each reference resolves. Changing settings restarts the app.
# Needs: az login, Key Vault Secrets Officer (or Administrator) on the vault, AZURE_SUBSCRIPTION in .env.
set -euo pipefail

GROUP=${AZURE_GROUP:-cwc-whatsupahead}
APP=${AZURE_APP:-whatsupahead}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
env_value() { grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
SUBSCRIPTION=${AZURE_SUBSCRIPTION:-$(env_value AZURE_SUBSCRIPTION)}
VAULT=${AZURE_VAULT:-$(env_value AZURE_VAULT)}
VAULT=${VAULT:-wua-kv-ce6a32}
[ -n "$SUBSCRIPTION" ] || {
	echo "set AZURE_SUBSCRIPTION (in .env or the environment)" >&2
	exit 1
}
KEYS=(WSDOT_CODE WINDY_API_KEY YOU_TUBE_DATA_API_KEY ORDOT_CODE_PRIMARY AZURE_MAPS_KEY)

umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

refs="{"
for name in "${KEYS[@]}"; do
	value=$(env_value "$name")
	if [ -z "$value" ]; then
		echo "skip $name (not in .env)"
		continue
	fi
	secret=$(echo "$name" | tr 'A-Z_' 'a-z-')
	printf '%s' "$value" >"$work/value"
	unset value
	az keyvault secret set --subscription "$SUBSCRIPTION" --vault-name "$VAULT" -n "$secret" \
		--file "$work/value" --encoding utf-8 -o none --only-show-errors
	rm -f "$work/value"
	echo "stored $name as $secret"
	refs+="\"$name\":\"@Microsoft.KeyVault(VaultName=$VAULT;SecretName=$secret)\","
done
refs="${refs%,}}"
[ "$refs" != "{}" ] || {
	echo "nothing to move" >&2
	exit 1
}

printf '%s' "$refs" >"$work/settings.json"
az webapp config appsettings set --subscription "$SUBSCRIPTION" -g "$GROUP" -n "$APP" \
	--settings "@$work/settings.json" -o none --only-show-errors
echo "app settings now point at $VAULT (the app restarts)"

# A reference that is set is not one that works: ask Azure whether each resolves (names and status only).
sleep 20
az rest --method get --only-show-errors --url \
	"https://management.azure.com/subscriptions/$SUBSCRIPTION/resourceGroups/$GROUP/providers/Microsoft.Web/sites/$APP/config/configreferences/appsettings?api-version=2023-12-01" \
	--query "value[?contains(properties.reference || '', '$VAULT')].{setting:name, status:properties.status}" -o table
