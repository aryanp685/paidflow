"""Synthetic fixtures test archive handling, not the real upstream release."""
import hashlib
import importlib.util
import io
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("verifier", "scripts/verify-supabase-auth-archive.py")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
ELF = b"\x7fELF\x02\x01\x01" + bytes(11) + b"\x3e\x00" + bytes(40)


def archive(extra=(), auth=ELF, link="auth", include_migration=True):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:xz") as t:
        def add(name, data=None, kind=tarfile.REGTYPE, target=""):
            entry = tarfile.TarInfo(name); entry.type = kind; entry.linkname = target
            entry.size = len(data) if data is not None else 0
            t.addfile(entry, io.BytesIO(data) if data is not None else None)
        add("auth", auth); add("gotrue", kind=tarfile.SYMTYPE, target=link)
        add("migrations/", kind=tarfile.DIRTYPE)
        if include_migration: add("migrations/00_test.up.sql", b"-- synthetic\n")
        for name, data, kind, target in extra: add(name, data, kind, target)
    return output.getvalue()


def inspect(blob):
    return verifier.inspect_archive(blob, expected_size=len(blob), expected_sha256=hashlib.sha256(blob).hexdigest())


class TestArchiveVerifier(unittest.TestCase):
    def test_matching_synthetic_archive_only_inspected(self):
        result = inspect(archive()); self.assertEqual(result['migration_files'], 1)
    def test_rejects_wrong_size_and_digest(self):
        blob=archive()
        with self.assertRaisesRegex(ValueError, 'size'): verifier.inspect_archive(blob, expected_size=len(blob)+1, expected_sha256=hashlib.sha256(blob).hexdigest())
        with self.assertRaisesRegex(ValueError, 'digest'): verifier.inspect_archive(blob, expected_size=len(blob), expected_sha256='0'*64)
    def test_rejects_traversal_and_nested_paths(self):
        for name in ['../escape','migrations/../../escape.sql','migrations/nested/file.sql','/etc/passwd']:
            with self.subTest(name=name),self.assertRaises(ValueError): inspect(archive([(name,b'x',tarfile.REGTYPE,'')]))
    def test_rejects_unexpected_links_and_duplicates(self):
        with self.assertRaises(ValueError): inspect(archive(link='../auth'))
        with self.assertRaises(ValueError): inspect(archive([('migrations/evil.sql',None,tarfile.SYMTYPE,'../auth')]))
        with self.assertRaises(ValueError): inspect(archive([('auth',ELF,tarfile.REGTYPE,'')]))
    def test_rejects_wrong_machine_and_missing_migrations(self):
        with self.assertRaises(ValueError): inspect(archive(auth=b'not-an-elf'))
        with self.assertRaises(ValueError): inspect(archive(include_migration=False))
    def test_rejects_truncated_xz_even_with_matching_synthetic_hash(self):
        with self.assertRaises((ValueError,tarfile.TarError,EOFError)): inspect(archive()[:-12])
    def test_rejects_trailing_data_and_decompression_limit(self):
        with self.assertRaises(ValueError): inspect(archive()+b'trailing')
        with patch.object(verifier,'MAX_TAR_BYTES',1024),self.assertRaises(ValueError): inspect(archive())
    def test_cli_cannot_override_pin(self):
        with tempfile.NamedTemporaryFile() as f:
            f.write(archive());f.flush()
            result=subprocess.run([sys.executable,'-B','scripts/verify-supabase-auth-archive.py',f.name],capture_output=True,text=True,check=False)
            self.assertEqual(result.returncode,1);self.assertIn('REJECTED',result.stderr)
            self.assertNotIn('Matches pinned',result.stdout)
    def test_no_follow_or_special_files(self):
        with tempfile.TemporaryDirectory() as d:
            file=os.path.join(d,'a'); link=os.path.join(d,'link'); fifo=os.path.join(d,'fifo')
            with open(file,'wb') as f: f.write(b'x')
            os.symlink(file,link);os.mkfifo(fifo)
            for path in [file,link,fifo]:
                with self.subTest(path=path),self.assertRaises((OSError,ValueError)): verifier.read_archive(path)

if __name__ == '__main__': unittest.main()
