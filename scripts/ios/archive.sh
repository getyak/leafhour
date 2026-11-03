#!/bin/bash
set -euo pipefail
# Only ephemeral GitHub macOS runners may install these signing materials.
[[ "${GITHUB_ACTIONS:-}" == true && "$(uname -s)" == Darwin && -n "${RUNNER_TEMP:-}" ]] || { echo 'Run signing only on an ephemeral GitHub macOS runner' >&2; exit 1; }
for name in IOS_DISTRIBUTION_P12_BASE64 IOS_DISTRIBUTION_P12_PASSWORD IOS_APP_STORE_PROFILE_BASE64 IOS_LISTENING_PROFILE_BASE64 IOS_TEAM_ID; do
  [[ -n "${!name:-}" ]] || { echo "Missing required secret/configuration: $name" >&2; exit 1; }
done
plan="${1:-release-plan.json}"
signing_dir="$(mktemp -d "$RUNNER_TEMP/leafhour-signing.XXXXXX")"
keychain="$signing_dir/signing.keychain-db"
profile_path=''
listening_profile_path=''
old_keychains=()
cleanup() {
  if [[ -n "$profile_path" ]]; then rm -f "$profile_path"; fi
  if [[ -n "$listening_profile_path" ]]; then rm -f "$listening_profile_path"; fi
  if [[ ${#old_keychains[@]} -gt 0 ]]; then security list-keychains -d user -s "${old_keychains[@]}" >/dev/null 2>&1 || true; fi
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$signing_dir"
}
trap cleanup EXIT
stage='decode-signing-material'
trap 'echo "iOS signing/archive failed at stage: $stage" >&2' ERR
export SIGNING_DIR="$signing_dir"
node --input-type=module <<'JS'
import {writeFileSync} from 'node:fs';
for (const [key,file] of [['IOS_DISTRIBUTION_P12_BASE64','distribution.p12'],['IOS_APP_STORE_PROFILE_BASE64','app.mobileprovision'],['IOS_LISTENING_PROFILE_BASE64','listening.mobileprovision']]) {
  const value=process.env[key];
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value)) throw Error('Invalid base64 signing material');
  writeFileSync(`${process.env.SIGNING_DIR}/${file}`,Buffer.from(value,'base64'),{mode:0o600});
}
JS
stage='decode-profile'
security cms -D -i "$signing_dir/app.mobileprovision" > "$signing_dir/profile.plist"
security cms -D -i "$signing_dir/listening.mobileprovision" > "$signing_dir/listening-profile.plist"
stage='extract-distribution-certificate'
bash scripts/ios/extract-certificate.sh "$signing_dir/distribution.p12" "$signing_dir/cert.pem"
stage='validate-distribution-certificate'
openssl x509 -in "$signing_dir/cert.pem" -checkend 604800 -noout >/dev/null
openssl x509 -in "$signing_dir/cert.pem" -outform DER -out "$signing_dir/cert.der"
python3 scripts/ios/signing.py "$signing_dir/profile.plist" "$plan" "$IOS_TEAM_ID" "$signing_dir/cert.der" "$signing_dir/listening-profile.plist" > "$signing_dir/profiles.json"
uuid="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1])); const ids=JSON.parse(fs.readFileSync(process.argv[2])); process.stdout.write(ids[p.bundleId])' "$plan" "$signing_dir/profiles.json")"
listening_uuid="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1])); const ids=JSON.parse(fs.readFileSync(process.argv[2])); process.stdout.write(ids[p.bundleId+".listening"])' "$plan" "$signing_dir/profiles.json")"
stage='install-profile-and-keychain'
profile_dir="$HOME/Library/MobileDevice/Provisioning Profiles"
mkdir -p "$profile_dir"
candidate_profile="$profile_dir/$uuid.mobileprovision"
[[ ! -e "$candidate_profile" ]] || { echo 'Refusing to replace an installed profile' >&2; exit 1; }
cp "$signing_dir/app.mobileprovision" "$candidate_profile"
profile_path="$candidate_profile"
candidate_listening_profile="$profile_dir/$listening_uuid.mobileprovision"
[[ ! -e "$candidate_listening_profile" ]] || { echo 'Refusing to replace an installed listening profile' >&2; exit 1; }
cp "$signing_dir/listening.mobileprovision" "$candidate_listening_profile"
listening_profile_path="$candidate_listening_profile"
keychain_password="$(openssl rand -hex 32)"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
while IFS= read -r line; do
  line="${line#*\"}"; line="${line%\"*}"
  old_keychains+=("$line")
done < <(security list-keychains -d user)
security list-keychains -d user -s "$keychain" "${old_keychains[@]}"
security import "$signing_dir/distribution.p12" -k "$keychain" -P "$IOS_DISTRIBUTION_P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -k "$keychain_password" "$keychain" >/dev/null
export RELEASE_PLAN="$plan" SIGNING_UUID="$uuid"
python3 - <<'PY'
import json,os,plistlib
plan=json.load(open(os.environ['RELEASE_PLAN']))
profiles=json.load(open(os.environ['SIGNING_DIR']+'/profiles.json'))
options={'method':'app-store-connect','destination':'export','signingStyle':'manual','teamID':os.environ['IOS_TEAM_ID'], 'provisioningProfiles':profiles,'manageAppVersionAndBuildNumber':False,'stripSwiftSymbols':True,'uploadSymbols':False}
with open(os.environ['SIGNING_DIR']+'/ExportOptions.plist','wb') as f:plistlib.dump(options,f)
PY
bundle_id="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.env.RELEASE_PLAN)).bundleId')"
version="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.env.RELEASE_PLAN)).version')"
build_number="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.env.RELEASE_PLAN)).buildNumber')"
# No -allowProvisioningUpdates: ordinary releases cannot create/repair Apple resources.
stage='archive'
xcodebuild -project apps/ios/Leafhour.xcodeproj -scheme Leafhour -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$RUNNER_TEMP/Leafhour.xcarchive" \
  -derivedDataPath "$RUNNER_TEMP/leafhour-release-derived" -jobs 2 \
  LEAFHOUR_BUNDLE_ID="$bundle_id" DEVELOPMENT_TEAM="$IOS_TEAM_ID" \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY='Apple Distribution' LEAFHOUR_MAIN_PROFILE="$uuid" LEAFHOUR_LISTENING_PROFILE="$listening_uuid" \
  OTHER_CODE_SIGN_FLAGS="--keychain $keychain" MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$build_number" archive
stage='export'
xcodebuild -exportArchive -archivePath "$RUNNER_TEMP/Leafhour.xcarchive" \
  -exportOptionsPlist "$signing_dir/ExportOptions.plist" -exportPath build/ios \
  OTHER_CODE_SIGN_FLAGS="--keychain $keychain"
stage='verify-exported-ipa'
python3 scripts/ios/verify-ipa.py build/ios/Leafhour.ipa "$plan" "$IOS_TEAM_ID"
cp "$plan" build/ios/release-plan.json
