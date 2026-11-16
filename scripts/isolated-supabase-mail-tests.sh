#!/bin/sh
# Synthetic mail-capture test only; does NOT start Supabase Auth or Postgres.
# Shares the host kernel; this is NOT the scanner/Garage no-NIC VM.
set -eu
cd "$(dirname "$0")/.."
root=$(mktemp -d /tmp/paidflow-mail-jail.XXXXXX)
trap 'rm -rf "$root"' EXIT HUP INT TERM
mkdir -p "$root/work/tests/supabase-auth" "$root/usr" "$root/lib" "$root/lib64" "$root/proc" "$root/tmp" "$root/dev" "$root/home" "$root/run" "$root/etc"
printf 'tester:x:1001:1001:tester:/tmp:/bin/sh\n' > "$root/etc/passwd"
printf 'tester:x:1001:\n' > "$root/etc/group"
cp tests/supabase-auth/mail_capture.py tests/supabase-auth/test_loopback_capture.py "$root/work/tests/supabase-auth/"
ln -s usr/bin "$root/bin"
touch "$root/dev/null" "$root/dev/urandom" "$root/dev/random"
env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/nonexistent \
 unshare --user --map-root-user --mount --net --ipc --pid --fork --kill-child sh -eu -c '
 root=$1
 mount --make-rprivate /
 links=$(ip -o link show); [ "$(printf "%s\n" "$links" | wc -l)" -eq 1 ]; printf "%s\n" "$links" | grep -q " lo: <"
 [ -z "$(ip -4 route show)" ] && [ -z "$(ip -6 route show)" ]
 ip link set lo up
 for d in usr lib lib64; do mount --bind "/$d" "$root/$d"; mount -o remount,bind,ro "$root/$d"; done
 for d in null urandom random; do mount --bind "/dev/$d" "$root/dev/$d"; done
 mount -t tmpfs -o size=32m,nosuid,nodev tmpfs "$root/tmp"
 mount -t proc -o nosuid,nodev,noexec proc "$root/proc"
 exec unshare --user --map-user=1001 --map-group=1001 --keep-caps --fork --kill-child \
 /usr/sbin/chroot "$root" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/bin HOME=/tmp TMPDIR=/tmp PYTHONDONTWRITEBYTECODE=1 \
 /usr/bin/setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
 /usr/bin/sh -eu -c '\''
  cd /work
  python3 -m unittest discover -s tests/supabase-auth -p "test_loopback_capture.py" -v
  [ -z "$(ss -H -lnt)" ]
  echo "Synthetic loopback test teardown complete; no listeners remain."
 '\''
 ' sh "$root"
# Treat jail deletion failure as a failed run, rather than hiding it in the trap.
rm -rf "$root"
trap - EXIT HUP INT TERM
