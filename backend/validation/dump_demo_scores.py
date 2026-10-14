#!/usr/bin/env python3
"""Dump demo coalition scores to JSON for sensitivity analysis."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from demo_data import DEMO_COALITION_SCORES, DEMO_CONTRIBUTORS

scores = {}
for coalition, result in DEMO_COALITION_SCORES.items():
    key = ",".join(str(i) for i in sorted(coalition))
    scores[key] = result["score"]

with open("demo_scores.json", "w") as f:
    json.dump(scores, f, indent=2)

names = [c["name"] for c in DEMO_CONTRIBUTORS]
with open("demo_names.json", "w") as f:
    json.dump(names, f, indent=2)

print(f"Dumped {len(scores)} coalition scores to demo_scores.json")
