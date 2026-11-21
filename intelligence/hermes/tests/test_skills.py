"""Skill registry tests — governance loading rules."""

import json

import pytest

from hermes.skills import SkillRegistry

SKILLS_DIR = __import__("pathlib").Path(__file__).resolve().parent.parent / "skills"


def test_repository_skills_load_and_are_valid():
    registry = SkillRegistry(SKILLS_DIR)
    assert registry.ids() == ["msk-001", "msk-006"]
    msk001 = registry.get("msk-001")
    assert msk001.status == "active"
    assert "call_paid_model_apis" in msk001.forbidden_actions
    msk006 = registry.get("msk-006")
    assert msk006.allowed_tools == ["bun_run_eval"]


def test_only_active_skills_are_routable():
    registry = SkillRegistry(SKILLS_DIR)
    assert registry.routable("msk-001") is True
    assert registry.routable("msk-999") is False


def test_manifest_without_forbidden_actions_is_refused(tmp_path):
    """Fail-closed: a skill that does not declare its forbids is invalid."""
    skill_dir = tmp_path / "msk-090-incomplete"
    skill_dir.mkdir()
    manifest = {
        "id": "msk-090",
        "name": "Incomplete skill",
        "version": "0.1.0",
        "owner": "tests",
        "status": "active",
        "purpose": "Missing forbidden_actions on purpose.",
        "allowed_tools": [],
        "task_types": ["ANY"],
        "inputs": "none",
        "outputs": "none",
        "test_command": "true",
    }
    (skill_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (skill_dir / "SKILL.md").write_text("# skill", encoding="utf-8")
    with pytest.raises(ValueError, match="msk-090"):
        SkillRegistry(tmp_path)


def test_manifest_without_skill_md_is_refused(tmp_path):
    skill_dir = tmp_path / "msk-091-no-doc"
    skill_dir.mkdir()
    manifest = {
        "id": "msk-091",
        "name": "No doc skill",
        "version": "0.1.0",
        "owner": "tests",
        "status": "active",
        "purpose": "Manifest without SKILL.md.",
        "allowed_tools": [],
        "forbidden_actions": ["nothing"],
        "task_types": ["ANY"],
        "inputs": "none",
        "outputs": "none",
        "test_command": "true",
    }
    (skill_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="msk-091"):
        SkillRegistry(tmp_path)


def test_unknown_status_is_refused(tmp_path):
    skill_dir = tmp_path / "msk-092-bad-status"
    skill_dir.mkdir()
    manifest = {
        "id": "msk-092",
        "name": "Bad status",
        "version": "0.1.0",
        "owner": "tests",
        "status": "super-active",
        "purpose": "Status outside the vocabulary.",
        "allowed_tools": [],
        "forbidden_actions": ["nothing"],
        "task_types": ["ANY"],
        "inputs": "none",
        "outputs": "none",
        "test_command": "true",
    }
    (skill_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (skill_dir / "SKILL.md").write_text("# skill", encoding="utf-8")
    with pytest.raises(ValueError, match="unknown status"):
        SkillRegistry(tmp_path)
