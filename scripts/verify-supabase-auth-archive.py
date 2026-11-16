#!/usr/bin/env python3
"""Offline inspection only: never extracts, installs or runs the provider.

Pinned to the upstream GitHub release v2.197.0 Linux amd64 archive. Its published
SHA-256 identifies that archive; it is not proof about a hosted Supabase version.
"""
import argparse
import hashlib
import io
import lzma
import os
import re
import stat
import sys
import tarfile

VERSION = "v2.197.0"
ARCHIVE_NAME = "auth-v2.197.0-amd64.tar.xz"
ARCHIVE_SIZE = 9_897_464
ARCHIVE_SHA256 = "b5c2991d1df760c9b099c1c2395a94bd1c2f83ed58901934921997179dc9f7ea"
MAX_ENTRIES = 1000
MAX_UNPACKED = 200 * 1024 * 1024
MAX_MIGRATION = 10 * 1024 * 1024
MAX_TAR_BYTES = MAX_UNPACKED + 4 * 1024 * 1024


def inspect_archive(blob, *, expected_size=ARCHIVE_SIZE, expected_sha256=ARCHIVE_SHA256):
    """Validate immutable archive bytes. Overridable only for synthetic unit tests."""
    if len(blob) != expected_size:
        raise ValueError("archive size does not match pinned release")
    if hashlib.sha256(blob).hexdigest() != expected_sha256:
        raise ValueError("archive digest does not match pinned release")
    # Require a complete single XZ stream and bound its decompressed tar size.
    decompressor = lzma.LZMADecompressor(format=lzma.FORMAT_XZ, memlimit=256 * 1024 * 1024)
    raw = decompressor.decompress(blob, max_length=MAX_TAR_BYTES + 1)
    if len(raw) > MAX_TAR_BYTES or not decompressor.eof or decompressor.unused_data:
        raise ValueError("incomplete, oversized or trailing XZ data")
    seen = set()
    total = 0
    migrations = 0
    auth_header = None
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        for item in archive:
            name = item.name.rstrip("/")
            if not name or name in seen or len(seen) >= MAX_ENTRIES:
                raise ValueError("empty, duplicate, or too many archive entries")
            seen.add(name)
            if item.size < 0:
                raise ValueError("invalid entry size")
            total += item.size
            if total > MAX_UNPACKED:
                raise ValueError("archive expands beyond limit")
            if name == "auth" and item.isfile():
                source = archive.extractfile(item)
                if source is None:
                    raise ValueError("missing auth executable data")
                auth_header = source.read(20)
            elif name == "gotrue" and item.issym() and item.linkname == "auth":
                pass  # Expected upstream alias; never followed.
            elif name == "migrations" and item.isdir():
                pass
            elif re.fullmatch(r"migrations/[A-Za-z0-9_.-]+\.sql", name) and item.isfile() and item.size <= MAX_MIGRATION:
                migrations += 1
            else:
                raise ValueError("unexpected or unsafe archive entry")
    if "auth" not in seen or "gotrue" not in seen or "migrations" not in seen or migrations == 0:
        raise ValueError("missing required release entries")
    # ELF64, little-endian, current ELF version, x86-64 e_machine.
    if not auth_header or len(auth_header) != 20 or auth_header[:7] != b"\x7fELF\x02\x01\x01" or auth_header[18:20] != b"\x3e\x00":
        raise ValueError("auth is not an ELF64 x86-64 binary")
    return {"entries": len(seen), "migration_files": migrations, "unpacked_bytes": total}


def read_archive(path):
    # Read a regular file once into memory; validation inspects those same bytes.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size != ARCHIVE_SIZE:
            raise ValueError("expected a regular archive file with the pinned size")
        with os.fdopen(fd, "rb", closefd=False) as source:
            blob = source.read(ARCHIVE_SIZE + 1)
        return blob
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description="Inspect the pinned official Supabase Auth archive offline; do not extract or run it.")
    parser.add_argument("archive", help="path to the v2.197.0 Linux amd64 release archive")
    args = parser.parse_args()
    try:
        result = inspect_archive(read_archive(args.archive))
    except (OSError, ValueError, tarfile.TarError, lzma.LZMAError, EOFError) as exc:
        print(f"REJECTED: {exc}", file=sys.stderr)
        return 1
    print(f"Matches pinned {VERSION} {ARCHIVE_NAME} SHA-256 {ARCHIVE_SHA256}; {result['migration_files']} migration files, {result['entries']} total entries.")
    print("Inspection only: no extraction, installation, provider execution or recovery verification was performed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
