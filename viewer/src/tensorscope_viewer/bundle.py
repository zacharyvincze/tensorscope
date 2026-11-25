"""Reader for tensorscope capture bundles (see spec/format.md)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

FORMAT = "tensorscope"
VERSION = 1

NOT_COMPARED, PASS, FAIL = 0, 1, 2


@dataclass
class Comparison:
    kind: str
    axes: list[str]
    compared: int | None  # None, like failed, when there is no status
    failed: int | None
    reference: np.ndarray
    actual: np.ndarray
    diff: np.ndarray | None  # actual - reference, NaN where not compared; None if not written
    status: np.ndarray | None  # NOT_COMPARED / PASS / FAIL; None if not written


@dataclass
class Case:
    path: Path
    name: str
    passed: bool
    failure: str
    comparisons: list[dict]

    @property
    def failed_elements(self) -> int:
        return sum(c.get("failed", 0) for c in self.comparisons)

    def load(self, index: int) -> Comparison:
        entry = self.comparisons[index]
        arrays = {
            role: np.load(self.path / file) for role, file in entry["arrays"].items()
        }
        return Comparison(
            entry["kind"],
            list(entry["axes"]),
            entry.get("compared"),
            entry.get("failed"),
            arrays["reference"],
            arrays["actual"],
            arrays.get("diff"),
            arrays.get("status"),
        )


def read_case(manifest: Path) -> Case:
    data = json.loads(manifest.read_text())
    if data.get("format") != FORMAT:
        raise ValueError(f"{manifest}: not a {FORMAT} manifest")
    if not isinstance(data.get("version"), int) or data["version"] > VERSION:
        raise ValueError(f"{manifest}: {FORMAT} version newer than v{VERSION}, update the viewer")
    return Case(
        manifest.parent,
        data["case"],
        data["passed"],
        data["failure"],
        data["comparisons"],
    )


def find_cases(root: Path) -> list[Case]:
    """Every bundle under root (or root itself), sorted by case name."""
    manifests = [root] if root.is_file() else sorted(root.rglob("manifest.json"))
    return sorted((read_case(m) for m in manifests), key=lambda c: c.name)
