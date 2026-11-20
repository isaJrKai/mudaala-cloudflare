"""Skill registry — governed, versioned Mudaala-owned skills.

A skill is procedural knowledge plus a permission envelope: what it may do,
what tools it may call, and what it must never do. Skills live in Git under
`intelligence/hermes/skills/<skill-id>/` with a `manifest.json` and a
`SKILL.md`.

Governance rules enforced here (master plan §7.2):
- Only skills with status `active` can be routed to.
- Manifests must declare allowed tools and forbidden actions; a manifest
  without explicit forbids is invalid (fail-closed).
- Every skill has an owner and a version; changes are Git-reviewed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

SKILL_ID_PATTERN = r"^msk-\d{3}$"
VALID_STATUSES = ("draft", "reviewed", "active", "retired")


class SkillManifest(BaseModel):
    id: str = Field(pattern=SKILL_ID_PATTERN)
    name: str = Field(min_length=3, max_length=80)
    version: str = Field(min_length=1, max_length=16)
    owner: str = Field(min_length=1, max_length=64)
    status: str
    purpose: str = Field(min_length=3, max_length=300)
    allowed_tools: list[str] = Field(max_length=12)
    forbidden_actions: list[str] = Field(min_length=1, max_length=12)
    task_types: list[str] = Field(min_length=1, max_length=6)
    inputs: str = Field(min_length=1, max_length=64)
    outputs: str = Field(min_length=1, max_length=64)
    test_command: str = Field(min_length=1, max_length=200)
    evidence_links: list[str] = Field(default_factory=list, max_length=6)


class SkillRegistry:
    def __init__(self, skills_dir: Path):
        self._skills: dict[str, SkillManifest] = {}
        self.load_from(skills_dir)

    def load_from(self, skills_dir: Path) -> None:
        """Load and validate every skill directory; invalid ones are refused
        loudly (registered as errors), never silently skipped."""
        self._skills = {}
        if not skills_dir.exists():
            return
        for manifest_path in sorted(skills_dir.glob("*/manifest.json")):
            raw: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
            try:
                manifest = SkillManifest.model_validate(raw)
            except ValidationError as error:
                raise ValueError(f"invalid skill manifest {manifest_path}: {error}") from error
            if manifest.status not in VALID_STATUSES:
                raise ValueError(f"skill {manifest.id} has unknown status {manifest.status}")
            if not (manifest_path.parent / "SKILL.md").exists():
                raise ValueError(f"skill {manifest.id} is missing SKILL.md")
            self._skills[manifest.id] = manifest

    def get(self, skill_id: str) -> SkillManifest:
        if skill_id not in self._skills:
            raise KeyError(f"unknown skill {skill_id}")
        return self._skills[skill_id]

    def routable(self, skill_id: str) -> bool:
        """Routable = known + active. Draft/reviewed/retired skills refuse."""
        skill = self._skills.get(skill_id)
        return skill is not None and skill.status == "active"

    def ids(self) -> list[str]:
        return sorted(self._skills.keys())
