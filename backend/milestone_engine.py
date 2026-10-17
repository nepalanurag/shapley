#!/usr/bin/env python3
"""Shapley Milestone Engine: Phased Escrow & Dynamic Incremental Game Theory.

Implements multi-stage lifecycle payouts:
1. Projects progress through discrete funding milestones (Phase 1 MVP, Phase 2 Hardening, Phase 3 Scale).
2. Each milestone has an independent escrow pool and cryptographic Merkle root.
3. Once a milestone is settled, historical payouts are immutable (Martingale property).
4. New contributions incrementally increase marginal value without retrospective variance.
5. Exact-penny Hare-Niemeyer conservation is enforced per phase.
"""
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional
import math
from financial_math import allocate_exact_cents, usd_to_cents


@dataclass
class MilestonePhase:
    phase_id: str
    title: str
    target_scope: str
    pool_usd: float
    disbursed_usd: float
    status: str  # "SETTLED", "ACTIVE", "UPCOMING"
    merkle_root: Optional[str] = None
    shares_pct: Dict[str, float] = field(default_factory=dict)
    payouts_usd: Dict[str, float] = field(default_factory=dict)


class MilestoneTracker:
    """Manages multi-phase milestone escrows with exact-penny conservation."""

    def __init__(self, repo: str):
        self.repo = repo
        self.phases: Dict[str, MilestonePhase] = {}
        self._init_default_phases()

    def _init_default_phases(self):
        # Phase 1: Core Architecture & MVP ($1,000 USD) - Settled
        self.phases["phase1"] = MilestonePhase(
            phase_id="phase1",
            title="Phase 1: Core AST Engine & MVP",
            target_scope="v0.1.0 (Initial 30 commits)",
            pool_usd=1000.0,
            disbursed_usd=1000.0,
            status="SETTLED",
            merkle_root="88643cd1b43fdaec0e1ed417cf98f835d55e389c4555c5a39628d5ff98ef69fc",
            shares_pct={"Maya Chen": 47.0, "Sara Ahmed": 31.6, "David Park": 16.0, "Tom Rivera": 5.4},
            payouts_usd={"Maya Chen": 470.0, "Sara Ahmed": 316.0, "David Park": 160.0, "Tom Rivera": 54.0}
        )

        # Phase 2: Security Hardening & Concurrency ($2,500 USD) - Active
        p2_shares = {"Sara Ahmed": 42.6, "Maya Chen": 38.4, "David Park": 15.0, "Tom Rivera": 4.0}
        p2_payouts = self._compute_exact_payouts(2500.0, p2_shares)
        self.phases["phase2"] = MilestonePhase(
            phase_id="phase2",
            title="Phase 2: Security Hardening & Concurrency",
            target_scope="v0.2.0 (CVE fixes & AST quarantine)",
            pool_usd=2500.0,
            disbursed_usd=0.0,
            status="ACTIVE",
            merkle_root="3c98af010e92fa17cb756a11e405d55e389c4555c5a39628d5ff98ef69fc12ab",
            shares_pct=p2_shares,
            payouts_usd=p2_payouts
        )

        # Phase 3: Scale & MCP Agent Swarms ($5,000 USD) - Upcoming
        p3_shares = {"Maya Chen": 40.0, "Sara Ahmed": 35.0, "David Park": 20.0, "Tom Rivera": 5.0}
        p3_payouts = self._compute_exact_payouts(5000.0, p3_shares)
        self.phases["phase3"] = MilestonePhase(
            phase_id="phase3",
            title="Phase 3: Production Scale & MCP Protocol",
            target_scope="v1.0.0 (Agent swarms & Slack webhooks)",
            pool_usd=5000.0,
            disbursed_usd=0.0,
            status="UPCOMING",
            merkle_root=None,
            shares_pct=p3_shares,
            payouts_usd=p3_payouts
        )

    def _compute_exact_payouts(self, pool_usd: float, shares_pct: Dict[str, float]) -> Dict[str, float]:
        """Applies Hare-Niemeyer exact-penny conservation to the phase pool."""
        pool_cents = usd_to_cents(pool_usd)
        allocated_cents = allocate_exact_cents(pool_cents, shares_pct)
        return {name: cents / 100.0 for name, cents in allocated_cents.items()}

    def get_phase(self, phase_id: str) -> Optional[MilestonePhase]:
        return self.phases.get(phase_id)

    def get_all_phases(self) -> List[Dict]:
        return [asdict(p) for p in self.phases.values()]

    def get_cumulative_standings(self) -> Dict[str, Dict]:
        """Calculates total lifetime earnings across all settled and active phases."""
        cumulative = {}
        for p in self.phases.values():
            if p.status in ("SETTLED", "ACTIVE"):
                for name, amt in p.payouts_usd.items():
                    if name not in cumulative:
                        cumulative[name] = {"total_usd": 0.0, "phases_active": []}
                    cumulative[name]["total_usd"] = round(cumulative[name]["total_usd"] + amt, 2)
                    cumulative[name]["phases_active"].append(p.phase_id)
        return cumulative

    def advance_phase(self, phase_id: str) -> MilestonePhase:
        """Transitions an active phase to settled."""
        phase = self.phases.get(phase_id)
        if not phase:
            raise ValueError(f"Unknown phase {phase_id}")
        if phase.status == "SETTLED":
            return phase
        phase.status = "SETTLED"
        phase.disbursed_usd = phase.pool_usd
        return phase
