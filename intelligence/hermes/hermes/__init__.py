"""Mudaala Hermes orchestration core.

Governance-first orchestration: skills, budgets, audit, durable task storage,
a backend seam and a worker loop. The control-plane HTTP API lives in
`hermes.server` (FastAPI); nothing here performs spend-bearing inference.
"""

__version__ = "0.2.0"
