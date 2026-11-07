#!/bin/sh
# Linux-only, synthetic offline tests. No server, database, customer data or scanner.
# Requires unprivileged user/mount/network/PID/IPC namespaces and chroot support.
set -eu
cd "$(dirname "$0")/.."
repo=$(pwd -P)
[ -d node_modules ] || { echo 'Restore locked dependencies first (npm ci --ignore-scripts).' >&2; exit 1; }
root=$(mktemp -d /tmp/paidflow-offline.XXXXXXXX)
trap 'rm -rf "$root"' EXIT HUP INT TERM
mkdir -p "$root/work" "$root/usr" "$root/lib" "$root/lib64" "$root/proc" "$root/tmp" "$root/dev" "$root/home" "$root/run"
# Only reviewed project sources and tests, not .git, env files or other projects.
git ls-files -z -- src tests neon/runtime better-auth-lab/core.mjs storage-lab package.json package-lock.json tsconfig.json vitest.config.mts | tar --null -T - -cf - | tar -xf - -C "$root/work"
# These two new test files may not yet be tracked in the working tree.
for f in tests/storage-lab/legacy-grant.mjs tests/storage-lab/download-hold-offline.mjs tests/unit/document-manager.test.tsx; do
  [ -f "$f" ] && cp "$f" "$root/work/$f"
done
mkdir -p "$root/work/node_modules"
touch "$root/dev/null" "$root/dev/urandom" "$root/dev/random"
# No inherited environment or open network/IPC namespace. Bind only runtime and
# installed dependencies, read-only; staged files and tmp are disposable.
env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/nonexistent \
  unshare --user --map-root-user --mount --net --ipc --pid --fork --kill-child sh -eu -c '
    root=$1; repo=$2
    mount --make-rprivate /
    # Only loopback may exist, and it must remain down; no IPv4 or IPv6 routes.
    links=$(ip -o link show)
    [ "$(printf "%s\n" "$links" | wc -l)" -eq 1 ]
    printf "%s\n" "$links" | grep -q " lo: <"
    if printf "%s\n" "$links" | grep -q "state UP"; then exit 1; fi
    [ -z "$(ip -4 route show)" ] && [ -z "$(ip -6 route show)" ]
    for d in usr lib lib64; do
      mount --bind "/$d" "$root/$d"
      mount -o remount,bind,ro "$root/$d"
    done
    mount --bind "$repo/node_modules" "$root/work/node_modules"
    mount -o remount,bind,ro "$root/work/node_modules"
    for d in null urandom random; do mount --bind "/dev/$d" "$root/dev/$d"; done
    mount -t tmpfs -o size=128m,nosuid,nodev tmpfs "$root/tmp"
    mount -t proc -o nosuid,nodev,noexec proc "$root/proc"
    # Drop all namespace capabilities before executing test code. The chroot has
    # no host /home, /run, /etc, .git, network routes, or host process table.
    cd "$root"
    exec chroot "$root" /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp TMPDIR=/tmp \
      /usr/bin/setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
      /usr/bin/sh -eu -c '\''
        cd /work
        node -e "const fs=require(\"fs\"),net=require(\"net\"),os=require(\"os\"); if(!/CapEff:\s+0+\b/.test(fs.readFileSync(\"/proc/self/status\",\"utf8\")))process.exit(4); if(fs.existsSync(\"/home/user\")||fs.existsSync(\"/run/user\")||fs.existsSync(\"/work/.git\")||process.env.AWS_SECRET_ACCESS_KEY)process.exit(1); const s=net.connect(80,\"1.1.1.1\");s.on(\"connect\",()=>process.exit(2));s.on(\"error\",e=>{if(e.code!==\"ENETUNREACH\")process.exit(3);console.log(\"Isolation probe: no external network route; host home, run sockets, git and inherited credentials absent\");});"
        node tests/storage-lab/download-hold-offline.mjs
        node node_modules/vitest/vitest.mjs run --configLoader runner
      '\''
  ' sh "$root" "$repo"
