#!/bin/sh
# Linux-only synthetic PostgreSQL/Better Auth/S3rver tests. Not a scanner sandbox.
# PAIDFLOW_TEST_PG_DIR must be an independently staged PostgreSQL binary directory
# under /tmp; never put credentials, user data or unrelated projects there.
set -eu
cd "$(dirname "$0")/.."
repo=$(pwd -P)
[ -d node_modules ] || { echo 'Restore locked dependencies first.' >&2; exit 1; }
pg_dir=$(realpath "${PAIDFLOW_TEST_PG_DIR:?Set PAIDFLOW_TEST_PG_DIR to a disposable PostgreSQL native directory under /tmp}")
case "$pg_dir" in /tmp/*) ;; *) echo 'PostgreSQL staging must be under /tmp.' >&2; exit 1;; esac
[ -x "$pg_dir/bin/postgres" ] && [ -x "$pg_dir/bin/initdb" ] && [ -d "$pg_dir/share" ] || { echo 'Invalid PostgreSQL staging directory.' >&2; exit 1; }
root=$(mktemp -d /tmp/paidflow-db-jail.XXXXXX)
trap 'rm -rf "$root"' EXIT HUP INT TERM
mkdir -p "$root/work" "$root/usr" "$root/lib" "$root/lib64" "$root/proc" "$root/tmp" "$root/dev" "$root/home" "$root/run" "$root/etc" "$root/pg"
printf 'tester:x:1001:1001:tester:/tmp:/bin/sh\n' > "$root/etc/passwd"
printf 'tester:x:1001:\n' > "$root/etc/group"
git ls-files -z -- src tests neon better-auth-lab storage-lab supabase package.json package-lock.json tsconfig.json vitest.config.mts | tar --null -T - -cf - | tar -xf - -C "$root/work"
[ ! -f storage-lab/migrations/20261107040000_storage_access_denials.sql ] || cp storage-lab/migrations/20261107040000_storage_access_denials.sql "$root/work/storage-lab/migrations/"
for f in tests/unit/auth-security.test.ts tests/unit/recovery-ui.test.tsx tests/unit/storage-audit-routes.test.ts; do [ ! -f "$f" ] || cp "$f" "$root/work/$f"; done
cp -a "$pg_dir/." "$root/pg/"
mkdir -p "$root/work/node_modules"
ln -s usr/bin "$root/bin"
touch "$root/dev/null" "$root/dev/urandom" "$root/dev/random"
env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/nonexistent \
 unshare --user --map-root-user --mount --net --ipc --pid --fork --kill-child sh -eu -c '
 root=$1; repo=$2
 mount --make-rprivate /
 links=$(ip -o link show); [ "$(printf "%s\n" "$links" | wc -l)" -eq 1 ]; printf "%s\n" "$links" | grep -q " lo: <"
 [ -z "$(ip -4 route show)" ] && [ -z "$(ip -6 route show)" ]
 ip link set lo up
 for d in usr lib lib64; do mount --bind "/$d" "$root/$d"; mount -o remount,bind,ro "$root/$d"; done
 mount --bind "$repo/node_modules" "$root/work/node_modules"; mount -o remount,bind,ro "$root/work/node_modules"
 for d in null urandom random; do mount --bind "/dev/$d" "$root/dev/$d"; done
 mount -t tmpfs -o size=256m,nosuid,nodev tmpfs "$root/tmp"
 mount -t proc -o nosuid,nodev,noexec proc "$root/proc"
 # PG must run non-root; map the single user to uid 1001 in a nested namespace.
 # Keep caps for chroot only, then drop all before processing any test code.
 exec unshare --user --map-user=1001 --map-group=1001 --keep-caps --fork --kill-child \
 /usr/sbin/chroot "$root" /usr/bin/env -i PATH=/pg/bin:/usr/local/bin:/usr/bin HOME=/tmp TMPDIR=/tmp LD_LIBRARY_PATH=/pg/lib BETTER_AUTH_TELEMETRY_DISABLED=1 \
 /usr/bin/setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
 /usr/bin/sh -eu -c '\''
  cd /work
  node -e "const fs=require(\"fs\"),net=require(\"net\"); if(process.getuid()===0||!/CapEff:\\s+0+\\b/.test(fs.readFileSync(\"/proc/self/status\",\"utf8\"))||fs.existsSync(\"/home/user\")||fs.existsSync(\"/run/user\")||fs.existsSync(\"/work/.git\"))process.exit(1);const s=net.connect(80,\"1.1.1.1\");s.on(\"connect\",()=>process.exit(2));s.on(\"error\",e=>{if(e.code!==\"ENETUNREACH\")process.exit(3);console.log(\"Isolated DB-test preflight passed: no egress, host home/socket/git absent, no capabilities\");});"
  initdb --no-locale --encoding=UTF8 -A trust -U postgres -D /tmp/pgdata >/dev/null
  pg_ctl -D /tmp/pgdata -l /tmp/postgres.log -o "-h 127.0.0.1 -p 55435 -k /tmp" start >/dev/null
  trap "pg_ctl -D /tmp/pgdata -m immediate stop >/dev/null || true" EXIT
  echo "PostgreSQL started in network namespace; services synthetic and loopback-only."
  listeners=$(ss -H -lnt)
  printf "%s\n" "$listeners"
  [ "$(printf "%s\n" "$listeners" | wc -l)" -eq 1 ]
  printf "%s\n" "$listeners" | grep -Eq "[[:space:]]127[.]0[.]0[.]1:55435[[:space:]]"
  PAIDFLOW_NEON_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/postgres node tests/neon/run-local.mjs --standalone
  PAIDFLOW_STORAGE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/postgres node tests/storage-lab/run-local.mjs --standalone
  PAIDFLOW_BA_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/postgres node tests/better-auth-lab/run-local.mjs --standalone
  PAIDFLOW_INTEGRATION_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/postgres node tests/integration/run-local.mjs --standalone
  PAIDFLOW_INTEGRATION_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/postgres node tests/integration/upgrade-local.mjs --standalone
  PAIDFLOW_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/postgres node tests/database/run-tests.mjs --standalone
 '\''
 ' sh "$root" "$repo"
