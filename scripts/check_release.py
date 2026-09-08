"""Check installer updates and ZIP reproducibility without touching global agent homes."""
from pathlib import Path
import argparse, hashlib, json, os, subprocess, tempfile, zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--bash", default="bash")
parser.add_argument("--powershell", default="powershell")
args = parser.parse_args()
manifest = json.loads((ROOT / "EXPORT-MANIFEST.json").read_text())
for item in manifest["files"]:
    assert hashlib.sha256((ROOT / item["path"]).read_bytes()).hexdigest() == item["export_sha256"], item["path"]
# Keep temporary homes in the repository's ignored test directory for sandbox portability.
base = ROOT / ".test-output"
base.mkdir(exist_ok=True)
for shell, command in [
    ("powershell", [args.powershell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "install.ps1"), "-Target", "all"]),
    ("bash", [args.bash, str(ROOT / "install.sh"), "--target", "all"]),
]:
    directory = Path(tempfile.mkdtemp(prefix=shell + "-", dir=base))
    env = os.environ.copy()
    env["CLAUDE_HOME"] = str(directory / "claude")
    env["CODEX_HOME"] = str(directory / "codex")
    def run(extra=()):
        result = subprocess.run(command + list(extra), env=env, capture_output=True, text=True)
        assert result.returncode == 0, (shell, result.stdout, result.stderr)
    run()
    for item in manifest["files"]:
        relative = item["path"]
        destination = directory / ("codex" if relative.startswith("codex/") else "claude") / relative.removeprefix("codex/")
        assert destination.read_bytes() == (ROOT / relative).read_bytes(), (shell, relative)
    target = directory / "claude/skills/dynamic-workflows-codex/SKILL.md"
    target.write_text("local customization")
    extra = target.parent / "local.txt"
    extra.write_text("keep")
    config = directory / "codex/config.toml"
    config.write_text("preserve config")
    run()
    assert target.read_text() == "local customization"
    run(["-Force" if shell == "powershell" else "--force"])
    assert target.read_bytes() == (ROOT / "skills/dynamic-workflows-codex/SKILL.md").read_bytes()
    assert extra.read_text() == "keep" and config.read_text() == "preserve config"
    assert not (target.parent / "dynamic-workflows-codex").exists()
    print(shell + ": fresh, repeat, force and local extras/config preservation PASS")
archives = []
for _ in range(2):
    output = Path(tempfile.mkdtemp(prefix="bundles-", dir=base))
    subprocess.run([os.sys.executable, str(ROOT / "scripts/build_bundles.py"), "--output", str(output)], check=True, capture_output=True)
    archives.append(output)
for archive in archives[0].glob("*.zip"):
    assert archive.read_bytes() == (archives[1] / archive.name).read_bytes()
    with zipfile.ZipFile(archive) as bundle:
        for name in bundle.namelist():
            assert bundle.read(name) == (ROOT / name).read_bytes(), name
    print(archive.name + ": deterministic, all entries match export PASS")
