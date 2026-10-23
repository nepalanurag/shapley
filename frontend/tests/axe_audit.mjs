/**
 * Phase 3 axe baseline for the results/explanation view (demo mode).
 *
 * Target committed FIRST in backend/validation/THRESHOLDS.md SS5: zero
 * critical axe violations on this view, to be MET by the end of
 * Phase 4. This script RECORDS the Phase 3 baseline; it does not fix
 * or gate on violations (exit 0 when the harness ran, 1 only when the
 * harness itself failed).
 *
 * Uses @axe-core/playwright — a TEST-ONLY devDependency: it audits the
 * built app from outside and ships nothing to users. Justification:
 * axe-core is the standard automated accessibility engine and there
 * was no existing a11y checker in the repo to reuse.
 *
 * Prerequisites: backend on :8000 and frontend (build + start) on
 * :3000, same as the other scripts in this directory.
 * Run: node tests/axe_audit.mjs
 * Output: console summary + backend/validation/axe_baseline_phase3.json
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const OUT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'backend', 'validation', 'axe_baseline_phase3.json');

function summarise(results) {
  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const violations = results.violations.map((v) => {
    if (v.impact in bySeverity) bySeverity[v.impact] += 1;
    return {
      id: v.id,
      impact: v.impact,
      help: v.help,
      node_count: v.nodes.length,
      first_target: v.nodes.length ? String(v.nodes[0].target) : null,
    };
  });
  return {
    violation_rule_count: violations.length,
    by_severity: bySeverity,
    violations,
    passes_count: results.passes.length,
    incomplete_count: results.incomplete.length,
  };
}

async function scan(page, label) {
  const results = await new AxeBuilder({ page }).analyze();
  const summary = summarise(results);
  console.log(`\n[${label}] rule violations: ${summary.violation_rule_count} ` +
    `(critical=${summary.by_severity.critical}, serious=${summary.by_severity.serious}, ` +
    `moderate=${summary.by_severity.moderate}, minor=${summary.by_severity.minor}); ` +
    `passes=${summary.passes_count}, incomplete=${summary.incomplete_count}`);
  for (const v of summary.violations) {
    console.log(`  - ${v.id} [${v.impact}] x${v.node_count}: ${v.help}`);
  }
  return summary;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  const url = `${FRONTEND_URL}/results?demo=true`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // The demo analysis must actually render before auditing: wait for a
  // frozen-demo contributor name to appear.
  await page.getByText('Maya Chen').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  const baseline = {
    phase: 3,
    target: 'zero critical violations by end of Phase 4 (THRESHOLDS.md SS5)',
    url,
    axe_core_version: '4.14.0',
    views: {},
  };
  baseline.views['results (demo)'] = await scan(page, 'results view, demo mode');

  // Explanation view: open the methodology/explainer section and rescan.
  const toggle = page.getByRole('button', { name: /Methodology & Axiomatic Proofs/ });
  await toggle.click();
  await page.waitForTimeout(1000);
  baseline.views['results + methodology explainer (demo)'] =
    await scan(page, 'results + explanation view, demo mode');

  await browser.close();
  writeFileSync(OUT_PATH, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`\nBaseline written to backend/validation/axe_baseline_phase3.json`);
}

main().catch((err) => {
  console.error('AXE HARNESS FAILED:', err.message);
  process.exit(1);
});
