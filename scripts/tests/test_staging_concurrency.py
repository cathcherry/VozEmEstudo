"""No PostgreSQL process or network request is used by these guard tests."""

import importlib.util
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "staging_concurrency", Path(__file__).resolve().parents[1] / "staging-concurrency.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StagingGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="e02-private-guard-")
        self.addCleanup(self.temporary.cleanup)
        folder = Path(self.temporary.name)
        self.ref = "abcdefghijklmnopqrst"
        self.service = folder / "service.conf"
        self.fixture = folder / "fixture.json"
        self.service_text = f"""[e02_staging]
host=db.{self.ref}.supabase.co
port=5432
dbname=postgres
user=postgres
password=synthetic-placeholder
sslmode=require
connect_timeout=10
"""
        self.service.write_text(self.service_text)
        self.fixture.write_text(
            json.dumps(
                {
                    "projectRef": self.ref,
                    "syntheticOnly": True,
                    "permissionVersion": "permission-v1:fake",
                    "fixtures": [
                        {
                            "label": label,
                            **{
                                name: str(uuid.uuid4())
                                for name in ["userId", "materialId", "sourceRevisionId"]
                            },
                        }
                        for label in ["A", "B"]
                    ],
                }
            )
        )
        self.service.chmod(0o600)
        self.fixture.chmod(0o600)
        self.source = {
            "E02_STAGING_WRITES_APPROVED": "true",
            "E02_SYNTHETIC_ONLY": "true",
            "E02_WORKERS_PAUSED": "true",
            "E02_STAGING_PROJECT_REF": self.ref,
            "E02_PGSERVICE": "e02_staging",
            "PGSERVICEFILE": str(self.service),
            "E02_FIXTURE_FILE": str(self.fixture),
        }

    def test_valid_isolated_direct_target(self):
        service_file, manifest = module.validate_settings(self.source)
        self.assertEqual(service_file, self.service)
        self.assertEqual(len(manifest["fixtures"]), 2)

    def test_no_authorization_never_starts_psql(self):
        with patch.object(module.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                module.main({})
            run.assert_not_called()

    def test_existing_project_and_running_workers_are_blocked(self):
        for values in [
            {"E02_STAGING_PROJECT_REF": module.EXISTING_PROJECT_REF},
            {"E02_WORKERS_PAUSED": "false"},
            {"E02_SYNTHETIC_ONLY": "false"},
        ]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                module.validate_settings({**self.source, **values})

    def test_wrong_host_transaction_pooler_and_disabled_tls_are_blocked(self):
        for original, replacement in [
            (f"db.{self.ref}.supabase.co", "db.other.supabase.co"),
            ("5432", "6543"),
            ("sslmode=require", "sslmode=disable"),
            ("user=postgres", "user=other"),
        ]:
            self.service.write_text(self.service_text.replace(original, replacement))
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                module.validate_settings(self.source)

    def test_session_pooler_is_bound_to_project_username(self):
        self.service.write_text(
            self.service_text.replace(
                f"db.{self.ref}.supabase.co", "aws-0-region.pooler.supabase.com"
            ).replace("user=postgres", f"user=postgres.{self.ref}")
        )
        module.validate_settings(self.source)
        self.service.write_text(
            self.service.read_text().replace(f"user=postgres.{self.ref}", "user=postgres.other")
        )
        with self.assertRaises(ValueError):
            module.validate_settings(self.source)

    def test_world_readable_credentials_and_wrong_fixture_target_are_blocked(self):
        self.service.chmod(0o644)
        with self.assertRaises(ValueError):
            module.validate_settings(self.source)
        self.service.chmod(0o600)
        payload = json.loads(self.fixture.read_text())
        payload["projectRef"] = module.EXISTING_PROJECT_REF
        self.fixture.write_text(json.dumps(payload))
        with self.assertRaises(ValueError):
            module.validate_settings(self.source)


if __name__ == "__main__":
    unittest.main()
