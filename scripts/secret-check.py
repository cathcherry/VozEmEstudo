"""Audit tracked source or a safe source archive; never echo detected content."""

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "distribution_audit", ROOT / "scripts/distribution-audit.py"
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def main():
    git = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], cwd=ROOT, capture_output=True, text=True
    )
    findings = []
    if git.returncode == 0 and Path(git.stdout.strip()).resolve() == ROOT:
        listed = subprocess.run(
            ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
        )
        paths = [name.decode("utf-8") for name in listed.stdout.split(b"\0") if name]
        for name in paths:
            reason = audit.path_reason(name)
            filename = ROOT / name
            if reason:
                findings.append({"path": name, "reason": reason})
            elif filename.is_symlink():
                findings.append({"path": name, "reason": "symlink"})
            elif filename.is_file():
                if filename.stat().st_size > audit.MAX_FILE_BYTES:
                    findings.append({"path": name, "reason": "file-size-limit"})
                else:
                    findings.extend(
                        {"path": name, "reason": reason}
                        for reason in audit.content_reasons(filename.read_bytes())
                    )
        scope = "git-tracked-source"
    else:
        with tempfile.TemporaryDirectory(prefix="voz-secret-check-") as directory:
            archive = Path(directory) / "source.zip"
            packed = audit.package_source(ROOT, archive)
            findings = packed["findings"] if not packed["passed"] else audit.audit_archive(archive)
        scope = "safe-distribution-source; no git history available"
    print(json.dumps({"scope": scope, "findings": findings}))
    return int(bool(findings))


if __name__ == "__main__":
    sys.exit(main())
