#!/usr/bin/env python3
"""Shapley Phase 2.3: Frozen demo data.

Deterministic demo scenario: 4 contributors, pre-computed Gemini scores,
pre-computed Shapley values. No API calls. Identical output every run.
"""

DEMO_CONTRIBUTORS = [
    {
        "name": "Maya Chen",
        "email": "maya@example.com",
        "commits": 8,
        "additions": 1240,
        "deletions": 310,
    },
    {
        "name": "David Park",
        "email": "david@example.com",
        "commits": 5,
        "additions": 420,
        "deletions": 85,
    },
    {
        "name": "Sara Ahmed",
        "email": "sara@example.com",
        "commits": 6,
        "additions": 890,
        "deletions": 200,
    },
    {
        "name": "Tom Rivera",
        "email": "tom@example.com",
        "commits": 3,
        "additions": 150,
        "deletions": 30,
    },
]

# Pre-computed coalition scores (frozen Gemini outputs)
# Key: sorted tuple of contributor indices
DEMO_COALITION_SCORES = {
    (): {"score": 0, "reasoning": "Empty coalition has zero value.", "confidence": 1.0},
    (0,): {"score": 72, "reasoning": "Maya's auth refactor is the architectural backbone. High complexity, unblocks all other work.", "confidence": 0.92},
    (1,): {"score": 35, "reasoning": "David's utility functions are solid but replaceable boilerplate.", "confidence": 0.85},
    (2,): {"score": 58, "reasoning": "Sara's API integration handles edge cases well. Moderate complexity, clear functional impact.", "confidence": 0.88},
    (3,): {"score": 12, "reasoning": "Tom's doc updates are helpful but low technical complexity.", "confidence": 0.95},
    (0, 1): {"score": 78, "reasoning": "Maya's architecture plus David's utilities form a working core. Strong synergy.", "confidence": 0.90},
    (0, 2): {"score": 85, "reasoning": "Maya's backend with Sara's API layer is nearly feature-complete. Excellent complementarity.", "confidence": 0.91},
    (0, 3): {"score": 74, "reasoning": "Maya's code with Tom's docs is well-documented but docs add marginal technical value.", "confidence": 0.89},
    (1, 2): {"score": 62, "reasoning": "David and Sara's combined work is functional but lacks Maya's architectural foundation.", "confidence": 0.87},
    (1, 3): {"score": 40, "reasoning": "Utilities plus docs without core architecture. Limited standalone value.", "confidence": 0.86},
    (2, 3): {"score": 60, "reasoning": "Sara's integration with documentation is presentable but missing backend depth.", "confidence": 0.88},
    (0, 1, 2): {"score": 92, "reasoning": "Full technical team. Architecture, utilities, and API integration combine into a robust product.", "confidence": 0.93},
    (0, 1, 3): {"score": 80, "reasoning": "Strong technical core with documentation. Missing Sara's API polish.", "confidence": 0.90},
    (0, 2, 3): {"score": 88, "reasoning": "Architecture, API, and docs. Well-rounded but missing David's utility layer.", "confidence": 0.91},
    (1, 2, 3): {"score": 65, "reasoning": "Functional product without Maya's architectural backbone. Works but fragile.", "confidence": 0.87},
    (0, 1, 2, 3): {"score": 95, "reasoning": "Complete team output. Production-ready with architecture, features, API, and documentation.", "confidence": 0.94},
}

# Pre-computed Shapley values from the above scores (verified by exact computation)
DEMO_SHAPLEY = {
    "shapley_values": {0: 44.7, 1: 15.2, 2: 30.0, 3: 5.2},
    "shares_pct": {0: 47.0, 1: 16.0, 2: 31.6, 3: 5.4},
}

DEMO_TOTAL = 1000.00


def get_demo_analysis():
    """Return the full frozen demo analysis."""
    contributors = []
    for idx, c in enumerate(DEMO_CONTRIBUTORS):
        sv = DEMO_SHAPLEY["shapley_values"][idx]
        pct = DEMO_SHAPLEY["shares_pct"][idx]
        contributors.append({
            **c,
            "shapley_value": sv,
            "share_pct": pct,
            "payout_usd": round(DEMO_TOTAL * pct / 100, 2),
        })

    evaluations = []
    for coalition, result in sorted(DEMO_COALITION_SCORES.items(),
                                    key=lambda x: (len(x[0]), x[0])):
        evaluations.append({
            "coalition": list(coalition),
            "members": [DEMO_CONTRIBUTORS[i]["name"] for i in coalition],
            "score": result["score"],
            "reasoning": result["reasoning"],
            "confidence": result["confidence"],
        })

    return {
        "repo": "demo/acme-project",
        "total_amount": DEMO_TOTAL,
        "contributors": contributors,
        "evaluations": evaluations,
        "api_calls": 0,
        "demo_mode": True,
        "num_coalitions": len(DEMO_COALITION_SCORES),
    }


if __name__ == "__main__":
    import json
    d1 = json.dumps(get_demo_analysis(), sort_keys=True)
    d2 = json.dumps(get_demo_analysis(), sort_keys=True)
    d3 = json.dumps(get_demo_analysis(), sort_keys=True)
    assert d1 == d2 == d3, "Demo output is NOT deterministic!"
    print("PASS: Demo output identical across 3 runs")
    data = json.loads(d1)
    print(f"  Contributors: {len(data['contributors'])}")
    print(f"  Coalitions: {data['num_coalitions']}")
    for c in data["contributors"]:
        print(f"  {c['name']:<15} {c['share_pct']:>5.1f}%  ${c['payout_usd']:>8.2f}")
