"""Validate an exact App Store profile and the certificate exported from its P12.

Profile bytes and certificate material never become workflow artifacts.
https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/
"""
import datetime as dt
import hashlib
import json
import plistlib
import re
import sys


def validate_profile(profile, plan, team_id, certificate_der, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    expiry = profile.get('ExpirationDate')
    if not isinstance(expiry, dt.datetime):
        raise ValueError('Profile expiration is missing')
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=dt.timezone.utc)
    if expiry - now < dt.timedelta(days=7):
        raise ValueError('Profile expires in fewer than seven days')
    if not re.fullmatch(r'[A-Z0-9]{10}', team_id or ''):
        raise ValueError('A verified Apple team ID is required')
    if profile.get('TeamIdentifier') != [team_id]:
        raise ValueError('Profile belongs to another team')
    entitlements = profile.get('Entitlements', {})
    # Older accounts may use an App ID prefix different from the team ID.
    prefixes = profile.get('ApplicationIdentifierPrefix', [])
    if len(prefixes) != 1 or entitlements.get('application-identifier') != prefixes[0] + '.' + plan['bundleId']:
        raise ValueError('Profile application identifier differs from the exact app')
    if entitlements.get('com.apple.developer.team-identifier') != team_id:
        raise ValueError('Profile entitlement team differs')
    if entitlements.get('get-task-allow') is not False or profile.get('ProvisionedDevices') or profile.get('ProvisionsAllDevices'):
        raise ValueError('An App Store distribution profile is required')
    if 'iOS' not in profile.get('Platform', []):
        raise ValueError('An iOS profile is required')
    fingerprint = hashlib.sha256(certificate_der).hexdigest()
    if not certificate_der or fingerprint not in [hashlib.sha256(cert).hexdigest() for cert in profile.get('DeveloperCertificates', [])]:
        raise ValueError('P12 certificate is not included in the profile')
    uuid = profile.get('UUID', '')
    if not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', uuid):
        raise ValueError('Profile UUID is invalid')
    return uuid


def validate_release_profiles(profiles, plan, team_id, certificate_der, now=None):
    expected = {plan['bundleId'], plan['bundleId'] + '.listening'}
    if set(profiles) != expected:
        raise ValueError('Release requires exact main app and listening extension profiles')
    result = {bundle: validate_profile(profile, {'bundleId': bundle}, team_id, certificate_der, now)
              for bundle, profile in profiles.items()}
    if len(set(result.values())) != len(result):
        raise ValueError('Main app and listening extension require distinct profile UUIDs')
    return result


if __name__ == '__main__':
    try:
        with open(sys.argv[1], 'rb') as file:
            profile = plistlib.load(file)
        with open(sys.argv[2]) as file:
            plan = json.load(file)
        with open(sys.argv[4], 'rb') as file:
            certificate = file.read()
        if len(sys.argv) == 6:
            with open(sys.argv[5], 'rb') as file:
                child = plistlib.load(file)
            print(json.dumps(validate_release_profiles({plan['bundleId']: profile, plan['bundleId'] + '.listening': child}, plan, sys.argv[3], certificate)))
        else:
            print(validate_profile(profile, plan, sys.argv[3], certificate))
    except Exception as error:
        sys.exit(str(error))
