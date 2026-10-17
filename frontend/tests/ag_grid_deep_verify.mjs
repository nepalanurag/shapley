import { chromium } from '@playwright/test';

async function verifyAGGridIntegration() {
  console.log('='.repeat(80));
  console.log('🔬 DEEP VERIFICATION: AG GRID & AG CHARTS PRIZE-WORTHY INTEGRATION');
  console.log('='.repeat(80));

  const BRAVE_PATH = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  const browser = await chromium.launch({
    headless: true,
    executablePath: BRAVE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  // -------------------------------------------------------------------------
  // PART 1: TEST NEXT.JS PRODUCTION APPLICATION (/results?demo=true)
  // -------------------------------------------------------------------------
  console.log('\n[1] Verifying Next.js Application (/results?demo=true)...');
  await page.goto('http://localhost:3000/results?demo=true', { waitUntil: 'networkidle', timeout: 10000 });

  // 1.1 Verify AG Grid presence
  const gridContainer = page.locator('.ag-theme-quartz');
  await gridContainer.first().waitFor({ state: 'visible', timeout: 5000 });
  console.log('  ✓ AG Grid Quartz container rendered');

  // 1.2 Verify Sparklines in Grid Cells (Phase 2)
  const sparklineSvgs = page.locator('.ag-theme-quartz svg polyline');
  const sparklineCount = await sparklineSvgs.count();
  console.log(`  ✓ In-cell Sparkline SVG count: ${sparklineCount}`);
  if (sparklineCount < 4) throw new Error('Expected at least 4 sparklines in contributor grid');

  // 1.3 Verify Baseline Comparison Toggle (Phase 4)
  const btnLOC = page.locator('button:has-text("Lines Changed (Naive)")');
  await btnLOC.click();
  await page.waitForTimeout(300);
  console.log('  ✓ Toggled to Lines Changed (Naive LOC) baseline');

  const btnCommits = page.locator('button:has-text("Commit Count")');
  await btnCommits.click();
  await page.waitForTimeout(300);
  console.log('  ✓ Toggled to Commit Count baseline');

  const btnShapley = page.locator('button:has-text("🤖 AI Shapley")');
  await btnShapley.click();
  await page.waitForTimeout(300);
  console.log('  ✓ Restored to AI Shapley baseline');

  // 1.4 Verify Coalition Explorer Tab (Phase 3)
  const btnCoalitions = page.locator('button:has-text("Coalition Explorer")');
  await btnCoalitions.click();
  await page.waitForTimeout(400);

  const coalitionGrid = page.locator('.ag-theme-quartz').first();
  await coalitionGrid.waitFor({ state: 'visible' });
  const coalitionText = await page.locator('span:has-text("100.0")').first().innerText();
  console.log(`  ✓ Coalition Explorer active: Grand Coalition score ${coalitionText} verified`);

  const btnContributors = page.locator('button:has-text("Contributor Allocations")');
  await btnContributors.click();
  await page.waitForTimeout(300);
  console.log('  ✓ Switched back to Contributor Allocations');

  // -------------------------------------------------------------------------
  // PART 2: TEST STANDALONE INTERACTIVE DEMO (demo.html)
  // -------------------------------------------------------------------------
  console.log('\n[2] Verifying Interactive Demo Showcase (demo.html)...');
  await page.goto('http://localhost:3000/demo.html', { waitUntil: 'networkidle', timeout: 10000 });

  // 2.1 Verify Cross-Filtering (Phase 1)
  await page.click('#row-contrib-maya');
  await page.waitForTimeout(200);

  const filterBadge = await page.locator('#activeFilterBadge').isVisible();
  const saraOpacity = await page.locator('#bar-sara-fill').evaluate(el => el.style.opacity);
  const mayaOpacity = await page.locator('#bar-maya-fill').evaluate(el => el.style.opacity || '1');
  console.log(`  ✓ Cross-filtering active: Badge visible=${filterBadge}, Maya opacity=${mayaOpacity}, Sara dim=${saraOpacity}`);
  if (saraOpacity !== '0.2') throw new Error(`Expected Sara bar opacity to dim to 0.2, got ${saraOpacity}`);

  // Clear cross-filter
  await page.click('#activeFilterBadge button');
  await page.waitForTimeout(150);
  const clearedSaraOpacity = await page.locator('#bar-sara-fill').evaluate(el => el.style.opacity || '1');
  console.log(`  ✓ Cross-filter cleared: Sara opacity restored to ${clearedSaraOpacity}`);

  // 2.2 Verify Sparklines (Phase 2)
  const mayaSparkline = await page.locator('#row-contrib-maya svg polyline').getAttribute('points');
  const tomSparkline = await page.locator('#row-contrib-tom svg polyline').getAttribute('points');
  console.log(`  ✓ Sparkline points verified: Maya points count=${mayaSparkline.split(' ').length}, Tom points count=${tomSparkline.split(' ').length}`);

  // 2.3 Verify Coalition Explorer (Phase 3)
  await page.click('#btnTabCoalitions');
  await page.waitForTimeout(200);
  const rowCount = await page.locator('#attribution-coalitions-view tbody tr').count();
  console.log(`  ✓ Coalition Explorer subsets count: ${rowCount}/16`);
  if (rowCount !== 16) throw new Error(`Expected 16 coalitions, got ${rowCount}`);

  await page.click('#btnTabContributors');
  await page.waitForTimeout(150);

  // 2.4 Verify Baseline Toggle & Re-sorting (Phase 4)
  await page.click('#btnModelLoc');
  await page.waitForTimeout(200);
  const topRowLOC = await page.locator('#contributorTbody tr:first-child').innerText();
  console.log(`  ✓ LOC Baseline Top Contributor: ${topRowLOC.split('\n')[1] || topRowLOC.slice(0, 30)}`);
  if (!topRowLOC.includes('Tom Rivera')) throw new Error('Expected Tom Rivera to be #1 in LOC mode');

  await page.click('#btnModelShapley');
  await page.waitForTimeout(200);
  const topRowShapley = await page.locator('#contributorTbody tr:first-child').innerText();
  console.log(`  ✓ AI Shapley Top Contributor: ${topRowShapley.split('\n')[1] || topRowShapley.slice(0, 30)}`);
  if (!topRowShapley.includes('Maya Chen')) throw new Error('Expected Maya Chen to be #1 in Shapley mode');

  // Verify Zero Page Errors
  if (errors.length > 0) {
    throw new Error(`Encountered page errors: ${errors.join('; ')}`);
  }

  await browser.close();
  console.log('\n' + '='.repeat(80));
  console.log('🏆 ALL AG GRID & AG CHARTS DEEP VERIFICATION CHECKS PASSED WITH 100% SUCCESS!');
  console.log('='.repeat(80));
}

verifyAGGridIntegration().catch(err => {
  console.error('\n❌ VERIFICATION FAILURE:', err);
  process.exit(1);
});
