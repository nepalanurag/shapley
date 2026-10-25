# Domain Docs

How engineering skills consume this repository's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repository root
- **`docs/adr/`**: architectural decision records covering axiomatic game theory, exact-penny Hare-Niemeyer apportionment, and PayPal Orders v2 / Payouts v1 settlement.

## File structure

Single-context repository layout:

```
/
├── GLOSSARY.md
├── docs/adr/
│   └── 0001-shapley-revenue-allocation.md
├── backend/
└── frontend/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a test name), use the exact term as defined in `GLOSSARY.md`.
