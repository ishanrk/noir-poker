from pathlib import Path

path = Path("apps/web/app/globals.css")
text = path.read_text()
needle = "  backdrop-filter: blur(10px);\n"
count = text.count(needle)
if count != 1:
    raise RuntimeError(f"expected one backdrop filter found {count}")
path.write_text(text.replace(needle, "", 1))
