from pathlib import Path
import re
import subprocess
import sys

extensions = {".css", ".js", ".mjs", ".mts", ".nr", ".py", ".rs", ".sh", ".ts", ".tsx"}
skips = (
    "apps/web/lib/aztec/artifacts/",
    "apps/web/lib/aztec/target/",
    "artifacts/",
    "node_modules/",
    "target/",
)
valid = re.compile(r"[a-z0-9 ]{1,80}")
violations = []

paths = subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")

for value in paths:
    path = Path(value)
    if not value or path.suffix not in extensions or value.startswith(skips) or not path.is_file():
        continue

    text = path.read_text(errors="replace")

    for number, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        body = None

        if stripped.startswith("//"):
            body = stripped.lstrip("/").strip()
        elif path.suffix == ".sh" and stripped.startswith("#") and not stripped.startswith("#!"):
            body = stripped[1:].strip()

        if body and not valid.fullmatch(" ".join(body.split())):
            violations.append(f"{value}:{number}:{body}")

    for match in re.finditer(r"/\*(.*?)\*/", text, re.DOTALL):
        start = text.count("\n", 0, match.start()) + 1
        body = " ".join(
            part.strip().lstrip("*").strip()
            for part in match.group(1).splitlines()
            if part.strip().lstrip("*").strip()
        )
        body = " ".join(body.split())

        if body and not valid.fullmatch(body):
            violations.append(f"{value}:{start}:{body}")

if violations:
    print("\n".join(violations))
    sys.exit(1)
