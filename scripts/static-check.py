"""Dependency-free syntax and local reference checks for the current project."""

import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


class PageReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.references = []
        self.head_order = []

    def handle_starttag(self, tag, values):
        attributes = dict(values)
        if attributes.get("id"):
            self.ids.append(attributes["id"])
        if tag in {"script", "img", "source"} and attributes.get("src"):
            self.references.append(attributes["src"])
        if tag == "script" and "theme-init.js" in attributes.get("src", ""):
            self.head_order.append("init")
        if tag == "link" and attributes.get("rel") in {"stylesheet", "icon", "apple-touch-icon"}:
            self.references.append(attributes.get("href", ""))
            if attributes.get("rel") == "stylesheet":
                self.head_order.append("css")
        if tag == "a" and ".html" in attributes.get("href", ""):
            self.references.append(attributes["href"])


def local_reference(value, origin):
    parsed = urlsplit(value)
    if parsed.scheme or value.startswith("//") or not parsed.path:
        return None
    part = unquote(parsed.path)
    if part.startswith("/"):
        folder = FRONTEND if part.startswith(("/js/", "/css/", "/assets/")) else FRONTEND / "pages"
        return folder / part[1:]
    return origin.parent / part


def main():
    issues = []
    pages = sorted((FRONTEND / "pages").glob("*.html"))

    def check_reference(value, origin):
        target = local_reference(value, origin)
        if target is not None and not target.is_file():
            issues.append(
                {
                    "file": str(origin.relative_to(ROOT)),
                    "reason": "missing-reference",
                    "reference": value,
                }
            )

    for file in pages:
        page = PageReferences()
        page.feed(file.read_text())
        if len(page.ids) != len(set(page.ids)):
            issues.append({"file": str(file.relative_to(ROOT)), "reason": "duplicate-id"})
        for reference in page.references:
            check_reference(reference, file)
        if (
            "init" in page.head_order
            and "css" in page.head_order
            and page.head_order.index("init") > page.head_order.index("css")
        ):
            issues.append(
                {"file": str(file.relative_to(ROOT)), "reason": "late-theme-initialization"}
            )
    for file in (FRONTEND / "css").glob("*.css"):
        for match in re.finditer(r"url\(\s*['\"]?([^'\")]+)", file.read_text()):
            check_reference(match[1].strip(), file)
    javascript = sorted(
        path
        for path in ROOT.rglob("*")
        if path.is_file()
        and path.suffix in {".js", ".cjs", ".mjs"}
        and not any(part in {"node_modules", ".git", ".claude"} for part in path.parts)
    )
    for file in javascript:
        if "vendor" in file.parts:
            continue
        for match in re.finditer(
            r"(?:\bfrom\s*|\bimport\s*\(\s*)['\"]([^'\"]+)['\"]", file.read_text()
        ):
            if match[1].startswith(("./", "../", "/")):
                check_reference(match[1], file)
    parser = """const fs=require('node:fs'),vm=require('node:vm');
const files=JSON.parse(fs.readFileSync(0,'utf8'));const errors=[];
for(const file of files){try{const code=fs.readFileSync(file,'utf8');
if(file.endsWith('.cjs'))new vm.Script(code,{filename:file});
else new vm.SourceTextModule(code,{identifier:file});
}catch{errors.push({file,reason:'javascript-syntax'});}}
process.stdout.write(JSON.stringify(errors));"""
    run = subprocess.run(
        ["node", "--no-warnings", "--experimental-vm-modules", "-e", parser],
        input=json.dumps([str(path) for path in javascript]),
        capture_output=True,
        text=True,
    )
    if run.returncode:
        issues.append({"reason": "node-parser-unavailable"})
    else:
        for error in json.loads(run.stdout):
            error["file"] = str(Path(error["file"]).relative_to(ROOT))
            issues.append(error)
    report = {
        "html_pages": len(pages),
        "javascript_files": len(javascript),
        "frontend_javascript": sum(FRONTEND in path.parents for path in javascript),
        "issues": issues,
        "scope": "Syntax and references; not ESLint/Prettier, OpenAPI validation or remote integration",
    }
    evidence = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if evidence is not None and evidence.parent.is_dir():
        evidence.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))
    return int(bool(issues))


if __name__ == "__main__":
    sys.exit(main())
