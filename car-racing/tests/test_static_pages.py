"""The repo's static pages: the explainer and the root redirects open, their scripts parse, local links exist.

    cd car-racing && .venv/bin/python -m pytest tests -q
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

LAB = Path(__file__).resolve().parents[2]
PAGES = [LAB / "index.html", LAB / "dashboard" / "index.html", *sorted((LAB / "explainers").glob("*.html"))]


@pytest.mark.parametrize("page", PAGES, ids=lambda p: str(p.relative_to(LAB)))
def test_local_links_exist(page):
    html = page.read_text()
    for ref in re.findall(r'(?:href|src)="([^"#?]+)"', html) + re.findall(r'url=([^"]+)"', html):
        if ref.startswith(("http:", "https:", "data:", "mailto:")):
            continue
        target = (page.parent / ref).resolve()
        assert target.exists(), f"{page.name} points to missing {ref}"


@pytest.mark.parametrize("page", PAGES, ids=lambda p: str(p.relative_to(LAB)))
def test_scripts_parse(page, tmp_path):
    if not shutil.which("node"):
        pytest.skip("node not installed")
    for i, js in enumerate(re.findall(r"<script>(.*?)</script>", page.read_text(), re.S)):
        f = tmp_path / f"s{i}.js"
        f.write_text(js)
        r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
