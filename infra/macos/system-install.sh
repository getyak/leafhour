#!/bin/sh
# Review locally, then run in an elevated operator terminal. No password is accepted as an argument.
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
umask 077
if [ "${1:-}" != '--prepare' ]; then
  echo 'Usage: sudo /bin/sh infra/macos/system-install.sh --prepare (creates only Leafhour identities/directories; does not start services)'
  exit 2
fi
if [ "$(id -u)" != 0 ]; then
  echo 'Use an elevated operator terminal; do not send an OS password through chat.' >&2
  exit 1
fi
task_root='/Library/Application Support/Leafhour'
if [ -L "$task_root" ]; then echo 'Leafhour root cannot be a symlink' >&2; exit 1; fi
for role in web api agent ipc; do
  task_name="_leafhour_$role"
  if ! dscl . -read "/Groups/$task_name" >/dev/null 2>&1; then
    task_id=450
    while dscl . -search /Groups PrimaryGroupID "$task_id" | /usr/bin/grep -q . || dscl . -search /Users UniqueID "$task_id" | /usr/bin/grep -q .; do
      task_id=$((task_id + 1))
      if [ "$task_id" -gt 499 ]; then echo 'No available service identity ID' >&2; exit 1; fi
    done
    dscl . -create "/Groups/$task_name"
    dscl . -create "/Groups/$task_name" PrimaryGroupID "$task_id"
    dscl . -create "/Groups/$task_name" RealName "Leafhour $role"
  fi
  if [ "$role" != ipc ]; then
    task_gid=$(dscl . -read "/Groups/$task_name" PrimaryGroupID | awk '{print $2}')
    if dscl . -read "/Users/$task_name" >/dev/null 2>&1; then
      test "$(dscl . -read "/Users/$task_name" UserShell | awk '{print $2}')" = /usr/bin/false || { echo 'Existing account is not the expected Leafhour service identity' >&2; exit 1; }
      test "$(dscl . -read "/Users/$task_name" PrimaryGroupID | awk '{print $2}')" = "$task_gid" || exit 1
    else
      if dscl . -search /Users UniqueID "$task_gid" | /usr/bin/grep -q .; then echo 'Service UID already belongs to another account' >&2; exit 1; fi
      dscl . -create "/Users/$task_name"
      dscl . -create "/Users/$task_name" UniqueID "$task_gid"
      dscl . -create "/Users/$task_name" PrimaryGroupID "$task_gid"
      dscl . -create "/Users/$task_name" UserShell /usr/bin/false
      dscl . -create "/Users/$task_name" NFSHomeDirectory /var/empty
      dscl . -create "/Users/$task_name" IsHidden 1
      dscl . -create "/Users/$task_name" Password '*'
      dscl . -create "/Users/$task_name" RealName "Leafhour $role service"
    fi
  fi
done
dseditgroup -o edit -a _leafhour_api -t user _leafhour_ipc
dseditgroup -o edit -a _leafhour_agent -t user _leafhour_ipc
/usr/bin/install -d -o root -g wheel -m 755 "$task_root" "$task_root/runtime" "$task_root/releases" "$task_root/ops" "$task_root/config" "$task_root/data" "$task_root/run" "$task_root/logs"
/usr/bin/install -d -o root -g wheel -m 700 "$task_root/state"
for role in web api agent; do
  /usr/bin/install -d -o root -g "_leafhour_$role" -m 750 "$task_root/config/$role"
  /usr/bin/install -d -o "_leafhour_$role" -g "_leafhour_$role" -m 750 "$task_root/logs/$role"
done
for role in api agent web; do
  /usr/bin/install -d -o "_leafhour_$role" -g "_leafhour_$role" -m 700 "$task_root/data/$role"
  /usr/bin/install -d -o "_leafhour_$role" -g "_leafhour_$role" -m 700 "$task_root/data/$role/home"
  /usr/bin/install -d -o "_leafhour_$role" -g "_leafhour_$role" -m 700 "$task_root/data/$role/tmp"
done
/usr/bin/install -d -o root -g _leafhour_ipc -m 750 "$task_root/config/ipc"
/usr/bin/install -d -o root -g _leafhour_ipc -m 2770 "$task_root/run/ipc"
/usr/bin/install -d -o _leafhour_web -g _leafhour_web -m 700 "$task_root/run/web"
echo 'Prepared Leafhour system identities and directories. No service was started; FileVault and networking were unchanged.'
