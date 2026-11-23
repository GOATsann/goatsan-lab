"""Tests for the training dashboard: the data exporters and the pages' scripts.

    cd car-racing && .venv/bin/python -m pytest tests -q
"""

import csv
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

DASH = Path(__file__).resolve().parents[1] / "dashboard"
sys.path.insert(0, str(DASH))


def make_shooter_run(root: Path, name: str, curriculum: bool) -> Path:
    run = root / name
    run.mkdir(parents=True)
    (run / "meta.json").write_text(json.dumps({"args": {"timesteps": 5e6, "curriculum": curriculum}, "game_version": 3}))
    (run / "reward.json").write_text(json.dumps({"weights": {"enemyVisible": {"w": 0.002}}}))
    with (run / "progress.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["steps", "minutes", "stage", "win_rate", "kd", "hit_rate", "headshot_share", "damage_per_min", "cut_off_share", "ref_win_rate", "ref_loss_rate", "ref_kill_share"])
        w.writerow([10240, 0.5, "self-play", 0.25, 1.2, 0.5, 0.3, 300, 0.1, 0.0, 0.0, 0.5])
        w.writerow([2007040, 9.0, "self-play", 0.5, 1.6, 0.55, 0.32, 410, 0.0, 0.02, 0.0, 0.61])
    (run / "stages.csv").write_text("0,still-5m,start,\n1505280,still-5m,time cap,0.0\n")
    bench = {"label": f"{name}@2.0M", "easy": {"win_rate": 0.8, "win_ci": [0.71, 0.87], "kd": 2.95, "hit_rate": 0.58, "headshot_share": 0.27, "damage_per_min": 525},
             "vs other": {"win_rate": 0.0, "win_ci": [0.0, 0.04], "matches": 2}}
    (run / "bench_2007040.json").write_text(json.dumps(bench))
    with (run / "bench_2007040.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["opponent", "kills", "deaths", "won", "lost"])
        w.writeheader()
        w.writerows([{"opponent": "easy", "kills": 10, "deaths": 3, "won": True, "lost": False},
                      {"opponent": "other", "kills": 3, "deaths": 1, "won": False, "lost": False},
                      {"opponent": "other", "kills": 1, "deaths": 3, "won": False, "lost": False}])
    return run


def test_export_shooter(tmp_path, monkeypatch):
    import export_shooter

    runs = tmp_path / "runs"
    make_shooter_run(runs, "A-curriculum", curriculum=True)
    make_shooter_run(runs, "t2-local-test", curriculum=False)  # local tests are left out
    out = tmp_path / "data-shooter.json"
    monkeypatch.setattr(export_shooter, "RUNS", runs)
    monkeypatch.setattr(export_shooter, "OUT", out)
    export_shooter.main()
    data = json.loads(out.read_text())
    assert list(data["runs"]) == ["A-curriculum"]
    r = data["runs"]["A-curriculum"]
    assert r["change"] == "curriculum" and r["target_steps"] == 5_000_000
    assert [x["score"] for x in r["races"]] == [25.0, 50.0]  # win rate vs Normal bots, in %
    assert r["series"]["ref_kill_share"] == [[10240, 50.0], [2007040, 61.0]]
    assert r["stages"][1] == {"steps": 1505280, "stage": "still-5m", "event": "time cap"}
    (b,) = r["shooter_bench"]
    assert b["label"] == "A-curriculum@2.0M"
    assert b["results"]["easy"]["kill_share"] == pytest.approx(10 / 13)
    assert b["results"]["vs other"]["kill_share"] == pytest.approx(4 / 8)  # kills / all kills, both matches


@pytest.mark.parametrize("page", ["index.html", "bench.html", "bench-shooter.html"])
def test_page_scripts_parse(page, tmp_path):
    """Every inline script of the dashboard pages must be valid JavaScript (node --check)."""
    if not shutil.which("node"):
        pytest.skip("node not installed")
    html = (DASH / page).read_text()
    scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
    assert scripts, f"{page} has no inline script"
    for i, js in enumerate(scripts):
        f = tmp_path / f"{page}.{i}.js"
        f.write_text(js)
        r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr


def test_every_project_link_points_to_a_page():
    """The project switcher and nav links name pages that exist."""
    for page in ("index.html", "bench.html", "bench-shooter.html"):
        html = (DASH / page).read_text()
        for href in re.findall(r'href="([a-z-]+\.html)', html):
            assert (DASH / href).exists(), f"{page} links to missing {href}"
