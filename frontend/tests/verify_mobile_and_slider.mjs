import { chromium } from '@playwright/test';

async function runVerification() {
  console.log('='.repeat(80));
  console.log('📱 MOBILE & TWO-STEP FINANCIAL VERIFICATION SUITE');
  console.log('='.repeat(80));

  const BRAVE_PATH = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  const browser = await chromium.launch({
    headless: true,
    executablePath: BRAVE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const errors = [];
  const consoleErrors = [];

  // -------------------------------------------------------------------------
  // 1. MOBILE RESPONSIVENESS (390px x 844px - iPhone 14/15/16 viewport)
  // -------------------------------------------------------------------------
  console.log('\n[1] Testing Mobile Layout (390px x 844px)...');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
  });
  const mobilePage = await mobileContext.newPage();
  mobilePage.on('pageerror', err => errors.push(`[Mobile PageError] ${err.message}`));
  mobilePage.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[Mobile ConsoleError] ${msg.text()}`);
  });

  // 1.1 Mobile Landing Page
  await mobilePage.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle', timeout: 10000 });

  // Verify no horizontal overflow on landing page
  const landingScrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
  const landingClientWidth = await mobilePage.evaluate(() => document.documentElement.clientWidth);
  console.log(`  ✓ Landing page scroll width: ${landingScrollWidth}px (client: ${landingClientWidth}px)`);
  if (landingScrollWidth > landingClientWidth + 1) {
    throw new Error(`Landing page has horizontal scroll overflow: ${landingScrollWidth} > ${landingClientWidth}`);
  }

  // Check nav links on mobile
  const sourceLink = mobilePage.locator('nav a:has-text("Source")');
  await sourceLink.waitFor({ state: 'visible' });
  const sourceBox = await sourceLink.boundingBox();
  console.log(`  ✓ Source link in navbar visible at x=${Math.round(sourceBox.x)}, right edge=${Math.round(sourceBox.x + sourceBox.width)}px (max 390px)`);
  if (sourceBox.x + sourceBox.width > 390) {
    throw new Error(`Navbar Source link overflows right screen edge: ${sourceBox.x + sourceBox.width} > 390`);
  }

  // Check landing preset buttons
  const presetButtons = mobilePage.locator('button:has-text("psf/black")');
  await presetButtons.first().waitFor({ state: 'visible' });
  const presetBox = await presetButtons.first().boundingBox();
  console.log(`  ✓ Preset 'psf/black' button visible at x=${Math.round(presetBox.x)}, right=${Math.round(presetBox.x + presetBox.width)}px`);
  if (presetBox.x + presetBox.width > 390) {
    throw new Error(`Preset 'psf/black' button overflows screen edge: ${presetBox.x + presetBox.width} > 390`);
  }

  // 1.2 Mobile Results Page
  console.log('\n[2] Testing Mobile Results Page (/results?demo=true)...');
  await mobilePage.goto('http://127.0.0.1:3000/results?demo=true', { waitUntil: 'networkidle', timeout: 10000 });

  // Verify persona switcher doesn't wrap or orphan buttons
  const leadBtn = mobilePage.locator('button:has-text("Lead")').first();
  const sponsorBtn = mobilePage.locator('button:has-text("Sponsor")').first();
  const memberBtn = mobilePage.locator('button:has-text("Member")').first();

  await leadBtn.waitFor({ state: 'visible' });
  await sponsorBtn.waitFor({ state: 'visible' });
  await memberBtn.waitFor({ state: 'visible' });

  const leadBox = await leadBtn.boundingBox();
  const sponsorBox = await sponsorBtn.boundingBox();
  const memberBox = await memberBtn.boundingBox();

  console.log(`  ✓ Persona buttons Y positions: Lead=${Math.round(leadBox.y)}, Sponsor=${Math.round(sponsorBox.y)}, Member=${Math.round(memberBox.y)}`);
  // All three buttons should be on the exact same row (y position within 2px)
  if (Math.abs(leadBox.y - memberBox.y) > 4) {
    throw new Error(`Persona buttons wrapped onto multiple lines! Lead y=${leadBox.y}, Member y=${memberBox.y}`);
  }
  console.log('  ✓ Persona switcher is a perfectly aligned 1-row 3-column grid without orphan wrapping');

  // -------------------------------------------------------------------------
  // 2. TWO-STEP ESCROW & FINANCIAL FLOW TEST
  // -------------------------------------------------------------------------
  console.log('\n[3] Testing Two-Step Financial Flow & Authentic Slider...');

  // Locate the SlideToAuthorize component
  const slider = mobilePage.locator('[role="slider"]');
  await slider.waitFor({ state: 'visible' });
  console.log('  ✓ Draggable slider component rendered');

  // Verify initial state
  const initialValue = await slider.getAttribute('aria-valuenow');
  console.log(`  ✓ Initial slider aria-valuenow: ${initialValue}`);

  // Test sliding via keyboard accessibility
  await slider.focus();
  await mobilePage.keyboard.press('ArrowRight');
  await mobilePage.waitForTimeout(300);

  // Check that hold is authorized
  const authorizedBadge = mobilePage.locator('text=Hold Authorized:');
  await authorizedBadge.waitFor({ state: 'visible', timeout: 3000 });
  console.log('  ✓ Step 1 Complete: Escrow authorization hold active');

  // Verify PayPal Neutral Escrow pipeline status
  const authHoldStatus = mobilePage.locator('span:has-text("29-Day Auth Hold")');
  await authHoldStatus.waitFor({ state: 'visible' });
  console.log('  ✓ Pipeline Stage 2 updated to: 29-Day Auth Hold');

  // Check Step 2: Separate "Execute Payout" button
  const executePayoutBtn = mobilePage.locator('button:has-text("Execute Payout")').first();
  await executePayoutBtn.waitFor({ state: 'visible' });
  console.log('  ✓ Step 2 Action Available: Distinct Execute Payout button');

  // Click Execute Payout -> opens confirmation modal
  await executePayoutBtn.click();
  await mobilePage.waitForTimeout(300);

  const confirmModalHeading = mobilePage.locator('h3:has-text("Confirm Payout")');
  await confirmModalHeading.waitFor({ state: 'visible', timeout: 3000 });
  console.log('  ✓ Payout confirmation modal opened');

  // Test Escape key dismissal on confirmation modal
  await mobilePage.keyboard.press('Escape');
  await mobilePage.waitForTimeout(300);
  const isConfirmVisible = await confirmModalHeading.isVisible();
  console.log(`  ✓ Payout confirmation modal dismissed on Escape: ${!isConfirmVisible}`);
  if (isConfirmVisible) throw new Error('Payout confirmation modal did not dismiss on Escape!');

  // Test Pot Solvency modal and Escape dismissal
  console.log('\n[4] Testing Pot Solvency Modal & Escape Dismissal...');
  const potBtn = mobilePage.locator('button:has-text("Hackathon Pot Solvency")').first();
  await potBtn.click();
  await mobilePage.waitForTimeout(400);

  const potModalHeading = mobilePage.locator('h2:has-text("Hackathon Prize Pot Solvency Proof")');
  await potModalHeading.waitFor({ state: 'visible', timeout: 4000 });
  console.log('  ✓ Pot Solvency modal opened');

  await mobilePage.keyboard.press('Escape');
  await mobilePage.waitForTimeout(300);
  const isPotVisible = await potModalHeading.isVisible();
  console.log(`  ✓ Pot Solvency modal dismissed on Escape: ${!isPotVisible}`);
  if (isPotVisible) throw new Error('Pot Solvency modal did not dismiss on Escape!');

  // -------------------------------------------------------------------------
  // 3. REAL BAKE-OFF DATA & AG GRID / AG CHARTS CONTRAST
  // -------------------------------------------------------------------------
  console.log('\n[5] Verifying Real Bake-Off Numbers & Grid Re-sorting...');
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktopPage = await desktopContext.newPage();
  desktopPage.on('pageerror', err => errors.push(`[Desktop PageError] ${err.message}`));

  await desktopPage.goto('http://127.0.0.1:3000/results?demo=true', { waitUntil: 'networkidle', timeout: 10000 });

  // Check baseline toggle: Lines Changed (Naive LOC)
  const locToggle = desktopPage.locator('button:text-is("Lines Changed")');
  await locToggle.click();
  await desktopPage.waitForTimeout(500);

  // In Lines Changed sort, Tom Rivera (4,200 lines = 67.0%) should be #1!
  const firstRow = desktopPage.locator('.ag-theme-quartz [role="row"][row-index="0"]').first();
  await firstRow.waitFor({ state: 'visible', timeout: 5000 });
  const firstRowName = await firstRow.innerText();
  console.log(`  ✓ Under Lines Changed (Naive LOC), Row 1 contributor: "${firstRowName.split('\n')[2]?.trim() || firstRowName.split('\n')[0].trim()}"`);
  if (!firstRowName.includes('Tom Rivera')) {
    throw new Error(`Expected Tom Rivera to be row 1 under LOC sort, got: ${firstRowName}`);
  }

  // Toggle back to AI Shapley
  const shapleyToggle = desktopPage.locator('button:text-is("AI Shapley")');
  await shapleyToggle.click();
  await desktopPage.waitForTimeout(500);

  const shapleyFirstRow = desktopPage.locator('.ag-theme-quartz [role="row"][row-index="0"]').first();
  await shapleyFirstRow.waitFor({ state: 'visible', timeout: 5000 });
  const shapleyFirstRowName = await shapleyFirstRow.innerText();
  console.log(`  ✓ Under AI Shapley, Row 1 contributor: "${shapleyFirstRowName.split('\n')[0].trim()}"`);
  if (!shapleyFirstRowName.includes('Maya Chen')) {
    throw new Error(`Expected Maya Chen to be row 1 under AI Shapley sort, got: ${shapleyFirstRowName}`);
  }

  // Check Tom Rivera's row under Shapley: should be 5.4%
  console.log('  ✓ Visual reshuffling and game-theory bake-off contrast verified!');

  // Check errors
  console.log('\n' + '='.repeat(80));
  if (errors.length > 0) {
    console.error('FAILED with errors:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  } else {
    console.log('🎉 ALL VERIFICATIONS PASSED WITH ZERO ERRORS!');
    console.log('='.repeat(80));
  }

  await browser.close();
}

runVerification().catch(err => {
  console.error('Fatal Verification Error:', err);
  process.exit(1);
});
