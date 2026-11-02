"""Build and inspect distribution archives without extracting or logging secrets."""

import argparse
import base64
import json
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

MAX_FILE_BYTES = 200 * 1024 * 1024
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
EXCLUDED_DIRECTORIES = {
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    ".pytest_cache",
    ".ruff_cache",
    ".cache",
    "backups",
    "dumps",
}
PRIVATE_NAMES = {".pgpass", ".pg_service.conf", "roles.sql", "data.sql", "backup.sql"}
PRIVATE_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".log", ".dump", ".backup"}
SECRET_PATTERNS = {
    "supabase-secret": rb"\bsb_secret_[A-Za-z0-9_-]{20,}",
    "groq-secret": rb"\bgsk_[A-Za-z0-9]{20,}",
    "huggingface-secret": rb"\bhf_[A-Za-z0-9]{20,}",
    "github-secret": rb"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})",
    "aws-access-key": rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    "private-key": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "database-password-uri": rb"\bpostgres(?:ql)?://[^\s/:]+:[^\s@]+@",
}
JWT_PATTERN = re.compile(rb"\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b")


def path_reason(name):
    path = PurePosixPath(name)
    parts = [part.casefold() for part in path.parts]
    if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
        return "unsafe-path"
    if any(part in EXCLUDED_DIRECTORIES for part in parts):
        return "excluded-directory"
    if any(part.startswith(".env") and part != ".env.example" for part in parts):
        return "environment-file"
    if path.name.casefold() in PRIVATE_NAMES or path.suffix.lower() in PRIVATE_SUFFIXES:
        return "private-file"
    if "frontend/tests/artifacts" in name and path.stem in {"fixture", "clip", "failure"}:
        return "temporary-test-artifact"
    return None


def content_reasons(data):
    reasons = {name for name, pattern in SECRET_PATTERNS.items() if re.search(pattern, data)}
    for match in JWT_PATTERN.finditer(data):
        try:
            payload = match.group(1)
            claims = json.loads(base64.urlsafe_b64decode(payload + b"=" * (-len(payload) % 4)))
            if isinstance(claims, dict) and claims.get("role") == "service_role":
                reasons.add("service-role-jwt")
            if isinstance(claims, dict) and claims.get("role") == "authenticated":
                reasons.add("user-session-jwt")
        except (ValueError, UnicodeError):
            continue
    return sorted(reasons)


def audit_archive(archive):
    findings = []
    with zipfile.ZipFile(archive) as package:
        members = package.infolist()
        if sum(member.file_size for member in members) > MAX_ARCHIVE_BYTES:
            return [{"path": archive.name, "reason": "archive-size-limit"}]
        names = set()
        for member in members:
            if member.filename in names:
                findings.append({"path": member.filename, "reason": "duplicate-path"})
            names.add(member.filename)
            reason = path_reason(member.filename)
            if reason:
                findings.append({"path": member.filename, "reason": reason})
                continue
            mode = member.external_attr >> 16
            if mode & 0o170000 == 0o120000:
                findings.append({"path": member.filename, "reason": "symlink"})
                continue
            if member.is_dir():
                continue
            if member.file_size > MAX_FILE_BYTES:
                findings.append({"path": member.filename, "reason": "file-size-limit"})
                continue
            data = package.read(member)
            for reason in content_reasons(data):
                findings.append({"path": member.filename, "reason": reason})
    return findings


def package_source(source, destination):
    source = source.resolve()
    destination = destination.resolve()
    if not source.is_dir() or destination.is_relative_to(source):
        raise ValueError("Use an existing source and an output outside that source.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    included = []
    excluded = 0
    for directory, directories, files in os.walk(source, followlinks=False):
        base = Path(directory)
        for name in list(directories):
            path = base / name
            if path.is_symlink():
                raise ValueError("Source contains a directory symlink.")
            if name.casefold() in EXCLUDED_DIRECTORIES or name.casefold().startswith(".env"):
                directories.remove(name)
                excluded += 1
        for name in sorted(files):
            path = base / name
            relative = path.relative_to(source).as_posix()
            if path_reason(relative):
                excluded += 1
                continue
            if path.is_symlink():
                raise ValueError("Source contains a file symlink.")
            included.append((path, relative))
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=destination.parent, suffix=".zip", delete=False
        ) as handle:
            temporary = Path(handle.name)
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as package:
            for path, relative in sorted(included):
                package.write(path, f"{source.name}/{relative}")
        findings = audit_archive(temporary)
        if findings:
            return {"passed": False, "findings": findings}
        os.replace(temporary, destination)
        temporary = None
        return {"passed": True, "files": len(included), "excluded": excluded, "findings": []}
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    audit = commands.add_parser("audit")
    audit.add_argument("archive", type=Path)
    pack = commands.add_parser("pack")
    pack.add_argument("source", type=Path)
    pack.add_argument("destination", type=Path)
    arguments = parser.parse_args()
    try:
        if arguments.command == "audit":
            findings = audit_archive(arguments.archive)
            report = {"passed": not findings, "findings": findings}
        else:
            report = package_source(arguments.source, arguments.destination)
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError):
        report = {"passed": False, "findings": [{"reason": "unreadable-or-invalid-input"}]}
    print(json.dumps(report, ensure_ascii=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
