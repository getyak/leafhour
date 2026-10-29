#!/bin/bash
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "$(uname -s)" == Darwin ]] || { echo 'Upload runs only on an approved ephemeral macOS runner' >&2; exit 1; }
[[ "${ASC_API_KEY_ID:-}" =~ ^[A-Z0-9]{10}$ && -n "${ASC_ISSUER_ID:-}" && -n "${ASC_PRIVATE_KEY_P8:-}" ]] || { echo 'Missing or invalid ASC credentials' >&2; exit 1; }
key_dir="$HOME/.appstoreconnect/private_keys"
mkdir -p "$key_dir"
key_path="$key_dir/AuthKey_$ASC_API_KEY_ID.p8"
[[ ! -e "$key_path" ]] || { echo 'Refusing to replace an existing ASC key file' >&2; exit 1; }
trap 'rm -f "$key_path" "$RUNNER_TEMP/leafhour-altool.log"' EXIT
umask 077
printf '%s' "$ASC_PRIVATE_KEY_P8" > "$key_path"
set +e
node scripts/ios/release.mjs probe
probe_status=$?
set -e
case "$probe_status" in
  0) echo 'Exact upload already exists; waiting for Apple processing without another transport submission' ;;
  2)
    if node scripts/ios/release.mjs can-submit; then
    # A network error may occur after Apple accepted the bytes. Always reconcile via ASC.
    set +e
    xcrun altool --upload-app --type ios --file build/ios/Leafhour.ipa --apiKey "$ASC_API_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" --output-format json > "$RUNNER_TEMP/leafhour-altool.log" 2>&1
    transport_status=$?
    set -e
    if [[ "$transport_status" -ne 0 ]]; then
      node scripts/ios/transport-diagnostics.mjs "$RUNNER_TEMP/leafhour-altool.log"
    fi
    echo "Transport exit status: $transport_status; independent Apple confirmation follows"
    else
      echo 'Later workflow attempts are reconciliation-only, including when Apple visibility is delayed. No additional transport submission.'
    fi
    ;;
  *) exit "$probe_status" ;;
esac
node scripts/ios/release.mjs wait
