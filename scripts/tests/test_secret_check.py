"""Check CI secret reporting against temporary repositories with fake values."""

import contextlib
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "secret_check", Path(__file__).resolve().parents[1] / "secret-check.py"
)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class SecretCheckTests(unittest.TestCase):
    def run_check(self, root):
        output = io.StringIO()
        with patch.object(checker, "ROOT", root), contextlib.redirect_stdout(output):
            result = checker.main()
        return result, output.getvalue()

    def test_tracked_environment_file_is_rejected_without_reading_values(self):
        with tempfile.TemporaryDirectory(prefix="voz-secret-repo-") as folder:
            root = Path(folder)
            subprocess.run(["git", "init", "--quiet", folder], check=True, capture_output=True)
            value = "synthetic-private-value-never-log"
            (root / ".env").write_text("PRIVATE_NAME=" + value)
            subprocess.run(["git", "add", ".env"], cwd=root, check=True)
            result, output = self.run_check(root)
            self.assertEqual(result, 1)
            self.assertNotIn(value, output)
            self.assertEqual(
                json.loads(output)["findings"], [{"path": ".env", "reason": "environment-file"}]
            )

    def test_tracked_provider_pattern_reports_only_path_and_category(self):
        with tempfile.TemporaryDirectory(prefix="voz-secret-content-") as folder:
            root = Path(folder)
            subprocess.run(["git", "init", "--quiet", folder], check=True, capture_output=True)
            value = "gsk_" + "x" * 48
            (root / "fixture.txt").write_text(value)
            subprocess.run(["git", "add", "fixture.txt"], cwd=root, check=True)
            result, output = self.run_check(root)
            self.assertEqual(result, 1)
            self.assertNotIn(value, output)
            self.assertEqual(
                json.loads(output)["findings"], [{"path": "fixture.txt", "reason": "groq-secret"}]
            )


if __name__ == "__main__":
    unittest.main()
