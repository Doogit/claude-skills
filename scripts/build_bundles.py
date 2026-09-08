"""Build deterministic, allowlisted archives from this public export."""
import argparse
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
COMMON = ["README.md", "LICENSE", "EXPORT-MANIFEST.json", "install.ps1", "install.sh"]
PACKAGES = {
    "dynamic-workflows-skills.zip": ["skills", "workflows", "agents"],
    "dynamic-workflows-codex-skills.zip": ["codex"],
}

def build(output):
    output.mkdir(parents=True, exist_ok=True)
    for name, directories in PACKAGES.items():
        paths = [ROOT / name for name in COMMON]
        for directory in directories:
            paths.extend(p for p in (ROOT / directory).rglob("*") if p.is_file())
        with ZipFile(output / name, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(paths):
                relative = path.relative_to(ROOT).as_posix()
                entry = ZipInfo(relative, date_time=(2026, 9, 8, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = (0o100755 if relative.endswith(".sh") else 0o100644) << 16
                entry.compress_type = ZIP_DEFLATED
                archive.writestr(entry, path.read_bytes())
        print(output / name)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    build(parser.parse_args().output.resolve())
