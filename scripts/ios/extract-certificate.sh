#!/bin/bash
set -euo pipefail
# OpenSSL 3 does not load the RC2 provider used by older macOS P12 exports.
# Try normal parsing first; enable legacy parsing only for that local operation.
source_p12="${1:?P12 path required}"
target_pem="${2:?Certificate output path required}"
temporary_pem="$(mktemp "${target_pem}.XXXXXX")"
trap 'rm -f "$temporary_pem"' EXIT
extract() {
  openssl pkcs12 "$@" -in "$source_p12" -clcerts -nokeys \
    -passin env:IOS_DISTRIBUTION_P12_PASSWORD -out "$temporary_pem" >/dev/null 2>&1
}
if ! extract; then
  if [[ "$(openssl version)" != 'OpenSSL 3.'* ]] || ! extract -legacy; then
    echo 'Unable to parse the distribution P12; verify its password and format' >&2
    exit 1
  fi
fi
mv "$temporary_pem" "$target_pem"
