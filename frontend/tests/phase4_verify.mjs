/**
 * Phase 4 functional verification for the coalition lattice hero.
 *
 * Checks, against the live demo API values (nothing hard-coded):
 *  1. The lattice is the first artifact: 2^n cells, honest count text.
 *  2. Selection syncs lattice -> waterfall and waterfall -> lattice.
 *  3. Focusing a contributor shows the correct marginal gain Δ on cells
 *     (recomputed here from the API's persisted evaluations).
 *  4. Cells are keyboard-operable and show a visible focus outline.
 *  5. 360px viewport: no horizontal overflow (screenshot saved).
 *  6. prefers-reduced-motion: entrance animation is effectively disabled.
 *
 * Prerequisites: backend on :8000 and frontend (build + start) on :3000.
 * Run: node tests/phase4_verify.mjs
 */
import { chromium } from '@playwright/test';

const FRONTEND = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
const SHOT_DIR = process.env.HOME;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const demo = await (await fetch(`${API}/api/demo`)).json();
const valueOf = (members) => {
  const key = JSON.stringify([...members].sort());
  const ev = demo.evaluations.find((e) => JSON.stringify([...e.members].sort()) === key);
  return ev ? ev.score : undefined;
};
const players = demo.contributors.map((c) => c.name);
const descId = (members) =>
  `coalition-desc-${members.length}-${members.map((m) => m.replace(/\W/g, '')).join('-')}`;

const browser = await chromium.launch({ headless: true });

// ── Desktop: lattice, sync, marginal gains, keyboard ──────────────────────
{
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  await page.goto(`${FRONTEND}/results?demo=true`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Maya Chen').first().waitFor({ state: 'visible', timeout: 60000 });

  const section = page.locator('section[aria-labelledby="lattice-heading"]');
  await section.waitFor({ state: 'visible' });
  const cells = section.locator('button[aria-describedby^="coalition-desc-"]');
  check('lattice renders every coalition cell', (await cells.count()) === demo.evaluations.length,
    `${await cells.count()} cells, ${demo.evaluations.length} evaluations`);
  check('count text states the full 2^n', await section.getByText(`All ${demo.evaluations.length} coalitions (2^${players.length}) are shown.`).isVisible());

  // Default selection is the grand coalition; the ledger's current step is v(N).
  const currentStep = section.locator('button[aria-current="true"]');
  check('default ledger step is the grand coalition',
    (await currentStep.innerText()).includes(`v = ${valueOf(players).toFixed(1)}`));

  // Lattice -> waterfall: select {Maya Chen, Sara Ahmed}.
  const target = ['Maya Chen', 'Sara Ahmed'];
  await section.locator(`button[aria-describedby="${descId(target)}"]`).click();
  check('clicked cell is pressed', await section.locator(`button[aria-describedby="${descId(target)}"]`).getAttribute('aria-pressed') === 'true');
  check('ledger follows lattice selection',
    (await section.locator('button[aria-current="true"]').innerText()).includes(`v = ${valueOf(target).toFixed(1)}`));

  // Waterfall -> lattice: click the "Add Maya Chen" ledger step.
  await section.getByRole('button', { name: /Add Maya Chen/ }).click();
  check('ledger step selects the prefix coalition in the lattice',
    await section.locator(`button[aria-describedby="${descId(['Maya Chen'])}"]`).getAttribute('aria-pressed') === 'true');

  // Contributor focus: pin Maya Chen; {David Park} cell must show the true Δ.
  await section.getByRole('button', { name: 'Maya Chen', exact: true }).click();
  const expectedDelta = Math.round((valueOf(['Maya Chen', 'David Park']) - valueOf(['David Park'])) * 10) / 10;
  const davidCell = section.locator(`button[aria-describedby="${descId(['David Park'])}"]`);
  check('cell shows the persisted marginal gain for the focus contributor',
    (await davidCell.innerText()).includes(`Δ Maya ${expectedDelta > 0 ? '+' : ''}${expectedDelta.toFixed(1)}`),
    `expected Δ Maya ${expectedDelta.toFixed(1)}`);

  // Keyboard: Tab from the last contributor chip reaches a lattice cell with
  // a visible outline; Enter selects it.
  await section.getByRole('button', { name: 'Tom Rivera', exact: true }).focus();
  let focusedCell = null;
  for (let i = 0; i < 8 && !focusedCell; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      return el && el.getAttribute('aria-describedby')?.startsWith('coalition-desc-')
        ? { id: el.getAttribute('aria-describedby'), outline: getComputedStyle(el).outlineWidth + ' ' + getComputedStyle(el).outlineStyle }
        : null;
    });
    if (info) focusedCell = info;
  }
  check('keyboard Tab reaches a coalition cell', !!focusedCell);
  check('focused cell has a visible outline', !!focusedCell && focusedCell.outline.startsWith('2px'), focusedCell?.outline);
  await page.keyboard.press('Enter');
  check('Enter selects the focused cell',
    await section.locator(`button[aria-describedby="${focusedCell.id}"]`).getAttribute('aria-pressed') === 'true');

  await section.screenshot({ path: `${SHOT_DIR}/shapley-phase4-hero.png` });
  await page.close();
}

// ── 360px: no horizontal overflow ──────────────────────────────────────────
{
  const page = await (await browser.newContext({ viewport: { width: 360, height: 800 } })).newPage();
  await page.goto(`${FRONTEND}/results?demo=true`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Maya Chen').first().waitFor({ state: 'visible', timeout: 60000 });
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check('360px: no horizontal overflow', scrollWidth <= clientWidth + 1, `scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
  await page.screenshot({ path: `${SHOT_DIR}/shapley-phase4-360.png` });
  await page.close();
}

// ── prefers-reduced-motion ────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${FRONTEND}/results?demo=true`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Maya Chen').first().waitFor({ state: 'visible', timeout: 60000 });
  const dur = await page.evaluate(() => {
    const el = document.querySelector('.animate-rise');
    return el ? parseFloat(getComputedStyle(el).animationDuration) : null;
  });
  check('reduced motion disables entrance animation', dur !== null && dur < 0.001, `animation-duration=${dur}s`);
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\nALL PHASE 4 CHECKS PASSED' : `\n${failures} PHASE 4 CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
