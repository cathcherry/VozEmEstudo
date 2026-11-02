"""Synthetic regression cases for the distribution audit; no real credentials."""

import base64
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "distribution-audit.py"
SPEC = importlib.util.spec_from_file_location("distribution_audit", SCRIPT)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class DistributionAuditTests(unittest.TestCase):
    def test_package_excludes_environment_dependencies_and_private_exports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            files = {
                "backend/.env": "SYNTHETIC_ONLY=value",
                "backend/.env.local": "SYNTHETIC_ONLY=value",
                "backend/.env.example": "SUPABASE_SECRET_KEY=your-server-key",
                "backend/node_modules/library/file.js": "dependency",
                "backups/data.sql": "synthetic data",
                "database/migrations/001_initial.sql": "-- synthetic migration",
                "frontend/pages/index.html": "<!doctype html>",
            }
            for name, content in files.items():
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            archive = root / "package.zip"
            self.assertTrue(AUDIT.package_source(source, archive)["passed"])
            with zipfile.ZipFile(archive) as package:
                self.assertEqual(
                    set(package.namelist()),
                    {
                        "source/backend/.env.example",
                        "source/database/migrations/001_initial.sql",
                        "source/frontend/pages/index.html",
                    },
                )
            self.assertEqual(AUDIT.audit_archive(archive), [])

    def test_archive_rejects_forbidden_paths_without_extraction(self):
        for name in [
            "backend/.env",
            "backend/.ENV",
            "backend/.env.private/config",
            "backend/node_modules/x.js",
            "../escape.js",
            "/absolute.js",
            "backups/schema.sql",
        ]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / "unsafe.zip"
                with zipfile.ZipFile(archive, "w") as package:
                    package.writestr(name, "synthetic")
                self.assertTrue(AUDIT.audit_archive(archive))

    def test_detected_secret_is_not_written_to_stdout(self):
        synthetic = "sb_" + "secret_" + "A" * 30
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as package:
                package.writestr("frontend/config.js", synthetic)
            run = subprocess.run(
                [sys.executable, str(SCRIPT), "audit", str(archive)], capture_output=True, text=True
            )
            self.assertEqual(run.returncode, 1)
            self.assertNotIn(synthetic, run.stdout + run.stderr)
            report = json.loads(run.stdout)
            self.assertEqual(
                report["findings"], [{"path": "frontend/config.js", "reason": "supabase-secret"}]
            )

    def test_detects_provider_keys_private_keys_and_service_role_jwt(self):
        payload = base64.urlsafe_b64encode(json.dumps({"role": "service_role"}).encode()).rstrip(
            b"="
        )
        jwt = b"eyJhbGciOiJIUzI1NiJ9." + payload + b".syntheticSignature"
        session_payload = base64.urlsafe_b64encode(
            json.dumps({"role": "authenticated"}).encode()
        ).rstrip(b"=")
        session_jwt = b"eyJhbGciOiJIUzI1NiJ9." + session_payload + b".syntheticSignature"
        samples = [
            (b"gsk" + b"_" + b"A" * 30, "groq-secret"),
            (b"hf" + b"_" + b"A" * 30, "huggingface-secret"),
            (b"ghp" + b"_" + b"A" * 30, "github-secret"),
            (b"-----BEGIN " + b"PRIVATE KEY-----", "private-key"),
            (jwt, "service-role-jwt"),
            (session_jwt, "user-session-jwt"),
        ]
        for value, reason in samples:
            with self.subTest(reason=reason):
                self.assertIn(reason, AUDIT.content_reasons(value))

    def test_rejects_symlinks_and_output_inside_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source"
            source.mkdir()
            with self.assertRaises(ValueError):
                AUDIT.package_source(source, source / "package.zip")
            (source / "link.js").symlink_to(source / "missing.js")
            with self.assertRaises(ValueError):
                AUDIT.package_source(source, Path(directory) / "package.zip")

    def test_a_failed_pack_does_not_replace_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            (source / "config.js").write_text("hf" + "_" + "A" * 30)
            archive = root / "package.zip"
            archive.write_bytes(b"original output")
            self.assertFalse(AUDIT.package_source(source, archive)["passed"])
            self.assertEqual(archive.read_bytes(), b"original output")


if __name__ == "__main__":
    unittest.main()
