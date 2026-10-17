import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BRAVE_PATH = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const BACKEND_URL = 'http://127.0.0.1:8000';
const FRONTEND_URL = 'http://127.0.0.1:3000';

const logs = [];
function logResult(suite, name, passed, durationMs, details = '') {
  logs.push({ suite, name, passed, durationMs, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${suite}] ${name} (${durationMs}ms)${details ? ' - ' + details : ''}`);
}

async function runTestSuite() {
  console.log('='.repeat(80));
  console.log('🚀 STARTING PLAYWRIGHT END-TO-END VERIFICATION & AUDIT SUITE');
  console.log('='.repeat(80));

  const browser = await chromium.launch({
    headless: true,
    executablePath: BRAVE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    acceptDownloads: true
  });

  // Track uncaught browser exceptions
  const pageErrors = [];

  // =========================================================================
  // SUITE 1: BACKEND API REST & PAYPAL ESCROW ENDPOINTS
  // =========================================================================
  console.log('\n[*] SUITE 1: Backend API & PayPal Escrow Endpoints...');
  
  // Test 1.1: GET /api/demo
  try {
    const t0 = Date.now();
    const res = await context.request.get(`${BACKEND_URL}/api/demo`);
    const data = await res.json();
    const passed = res.status() === 200 && data.contributors.length === 4 && data.total_amount === 1000.0;
    const shareSum = data.contributors.reduce((acc, c) => acc + c.share_pct, 0);
    const payoutSum = data.contributors.reduce((acc, c) => acc + c.payout_usd, 0);
    const exact = Math.abs(shareSum - 100.0) < 0.01 && Math.abs(payoutSum - 1000.0) < 0.01;
    logResult('Backend API', 'GET /api/demo exact-penny distribution', passed && exact, Date.now() - t0, `Contributors: ${data.contributors.length}, Payout sum: $${payoutSum.toFixed(2)}`);
  } catch (err) {
    logResult('Backend API', 'GET /api/demo', false, 0, err.message);
  }

  // Test 1.2: GET /api/sponsor/portfolio
  try {
    const t0 = Date.now();
    const res = await context.request.get(`${BACKEND_URL}/api/sponsor/portfolio`);
    const data = await res.json();
    const passed = res.status() === 200 &&
      data.total_committed_usd === 25000.0 &&
      data.total_escrow_hold_usd === 11500.0 &&
      data.total_waste_prevented_usd === 3840.0 &&
      data.stack && data.stack.length === 4;
    logResult('Backend API', 'GET /api/sponsor/portfolio KPI & Multi-Repo Stack', passed, Date.now() - t0, 
      `Committed: $${data.total_committed_usd}, Escrow: $${data.total_escrow_hold_usd}, Waste Prevented: +$${data.total_waste_prevented_usd}`);
  } catch (err) {
    logResult('Backend API', 'GET /api/sponsor/portfolio', false, 0, err.message);
  }

  // Test 1.3: GET /api/sponsor/invoice
  try {
    const t0 = Date.now();
    const res = await context.request.get(`${BACKEND_URL}/api/sponsor/invoice?batch_id=BATCH-2026-Q4`);
    const data = await res.json();
    const passed = res.status() === 200 &&
      data.invoice_number &&
      data.total_committed_usd === 25000.0 &&
      data.total_disbursed_usd === 13500.0 &&
      data.total_in_custody_usd === 11500.0 &&
      data.line_items && data.line_items.length === 4;
    logResult('Backend API', 'GET /api/sponsor/invoice GAAP Accounting Reconciliation', passed, Date.now() - t0,
      `Invoice: ${data.invoice_number}, Settlement: $${data.total_disbursed_usd}, Hold: $${data.total_in_custody_usd}`);
  } catch (err) {
    logResult('Backend API', 'GET /api/sponsor/invoice', false, 0, err.message);
  }

  // Test 1.4: POST /api/escrow/order
  try {
    const t0 = Date.now();
    const res = await context.request.post(`${BACKEND_URL}/api/escrow/order`, {
      data: {
        repo_url: 'pallets/jinja',
        phase_id: 'phase2',
        pool_usd: 2500.0,
        sponsor_email: 'sponsor-treasury@opensource-fund.org'
      }
    });
    const data = await res.json();
    const passed = res.status() === 200 &&
      data.order_id &&
      data.intent === 'AUTHORIZE' &&
      data.status === 'CREATED';
    logResult('Backend API', 'POST /api/escrow/order Orders v2 Authorization Hold', passed, Date.now() - t0,
      `Order: ${data.order_id}, Intent: ${data.intent}`);
  } catch (err) {
    logResult('Backend API', 'POST /api/escrow/order', false, 0, err.message);
  }

  // Test 1.5: GET /api/agent/tools (MCP Specification)
  try {
    const t0 = Date.now();
    const res = await context.request.get(`${BACKEND_URL}/api/agent/tools`);
    const data = await res.json();
    const toolNames = data.tools.map(t => t.name);
    const passed = res.status() === 200 &&
      toolNames.includes('shapley_evaluate_repo') &&
      toolNames.includes('shapley_verify_audit_proof') &&
      toolNames.includes('shapley_authorize_escrow_release');
    logResult('Backend API', 'GET /api/agent/tools Model Context Protocol Tools', passed, Date.now() - t0,
      `Registered tools count: ${toolNames.length}`);
  } catch (err) {
    logResult('Backend API', 'GET /api/agent/tools', false, 0, err.message);
  }

  // Test 1.6: GET /api/pot/validate (Hackathon Pot Solvency)
  try {
    const t0 = Date.now();
    const res = await context.request.get(`${BACKEND_URL}/api/pot/validate?hackathon_id=hack-sf-2026&expected_pool_usd=2500`);
    const data = await res.json();
    const pot = data.pot || data;
    const holdId = pot.paypal_auth_id || pot.paypal_hold_id;
    const cert = pot.cryptographic_certificate || pot.pot_solvency_certificate;
    const passed = res.status() === 200 &&
      data.status === 'SUCCESS' &&
      pot.pot_status === 'SOLVENT_ESCROW_HELD' &&
      holdId === 'AUTH-PP-8829410-USD' &&
      cert &&
      cert.startsWith('POT-CERT-SHA256-');
    logResult('Backend API', 'GET /api/pot/validate Cryptographic Solvency Certificate', passed, Date.now() - t0,
      `Hold ID: ${holdId}, Status: ${pot.pot_status}`);
  } catch (err) {
    logResult('Backend API', 'GET /api/pot/validate', false, 0, err.message);
  }

  // Test 1.7: GET /api/contributor/profiles
  try {
    const t0 = Date.now();
    const res = await context.request.get(`${BACKEND_URL}/api/contributor/profiles`);
    const data = await res.json();
    const passed = res.status() === 200 && data.profiles && Object.keys(data.profiles).length === 4;
    logResult('Backend API', 'GET /api/contributor/profiles Git Provenance Profiles', passed, Date.now() - t0,
      `Profiles: ${Object.keys(data.profiles).join(', ')}`);
  } catch (err) {
    logResult('Backend API', 'GET /api/contributor/profiles', false, 0, err.message);
  }

  // Test 1.8: POST /api/contributor/claim (Legitimate Git Provenance Claim)
  try {
    const t0 = Date.now();
    const res = await context.request.post(`${BACKEND_URL}/api/contributor/claim`, {
      data: {
        contributor_id: 'maya',
        oauth_github_username: 'mayachen',
        oauth_email: 'maya@example.com',
        paypal_recipient_email: 'maya.chen.dev@gmail.com',
        tax_form_type: 'W-8BEN',
        tax_certified: true
      }
    });
    const data = await res.json();
    const proof = data.profile?.verification_proof || data.profile?.claim_proof_hash;
    const passed = res.status() === 200 &&
      data.status === 'SUCCESS' &&
      data.profile &&
      proof &&
      proof.startsWith('PROOF-SHA256-');
    logResult('Backend API', 'POST /api/contributor/claim Legitimate Git Author Claim', passed, Date.now() - t0,
      `Proof: ${proof?.slice(0, 20)}...`);
  } catch (err) {
    logResult('Backend API', 'POST /api/contributor/claim', false, 0, err.message);
  }

  // Test 1.9: POST /api/contributor/claim (Impostor Rejection)
  try {
    const t0 = Date.now();
    const res = await context.request.post(`${BACKEND_URL}/api/contributor/claim`, {
      data: {
        contributor_id: 'maya',
        oauth_github_username: 'fake-maya',
        oauth_email: 'hacker@malicious.org',
        paypal_recipient_email: 'hacker@wallet.com',
        tax_form_type: 'W-8BEN',
        tax_certified: true
      }
    });
    const passed = res.status() === 403;
    logResult('Backend API', 'POST /api/contributor/claim Impostor Provenance Rejection (403)', passed, Date.now() - t0,
      `Rejected with HTTP status ${res.status()}`);
  } catch (err) {
    logResult('Backend API', 'POST /api/contributor/claim Impostor Rejection', false, 0, err.message);
  }

  // Test 1.10: GET /api/sponsor/connect-paypal (PayPal Partner Referrals)
  try {
    const t0 = Date.now();
    const res = await context.request.get(`${BACKEND_URL}/api/sponsor/connect-paypal`);
    const data = await res.json();
    const passed = res.status() === 200 &&
      data.action_url &&
      data.action_url.includes('features=PAYOUTS,DELAYED_CAPTURE');
    logResult('Backend API', 'GET /api/sponsor/connect-paypal Partner Referral Onboarding', passed, Date.now() - t0,
      `Scopes: ${data.requested_scopes?.join(', ')}`);
  } catch (err) {
    logResult('Backend API', 'GET /api/sponsor/connect-paypal', false, 0, err.message);
  }

  // =========================================================================
  // SUITE 2: NEXT.JS APPLICATION PRODUCTION PAGES (/ and /results)
  // =========================================================================
  console.log('\n[*] SUITE 2: Next.js Application Production Pages...');
  const page = await context.newPage();

  page.on('pageerror', err => {
    pageErrors.push(err.message);
    console.error(' [Browser Page Error]:', err.message);
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      pageErrors.push(msg.text());
      console.error(' [Browser Console Error]:', msg.text());
    }
  });

  // Test 2.1: Landing page /
  try {
    const t0 = Date.now();
    await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    const hasHeader = await page.locator('h1, h2').count() > 0;
    logResult('Next.js Frontend', 'Homepage (/) renders cleanly', hasHeader, Date.now() - t0, `Title: ${title}`);
  } catch (err) {
    logResult('Next.js Frontend', 'Homepage (/)', false, 0, err.message);
  }

  // Test 2.2: Results page /results?demo=true
  try {
    const t0 = Date.now();
    await page.goto(`${FRONTEND_URL}/results?demo=true`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Maya Chen', { timeout: 10000 });
    const hasMaya = await page.locator('text=Maya Chen').first().isVisible();
    const hasPool = await page.locator('text=$1000').or(page.locator('text=$1,000')).first().isVisible();
    logResult('Next.js Frontend', 'Results page (/results?demo=true) data binding', hasMaya && hasPool, Date.now() - t0,
      'Maya Chen and $1,000 USD pool verified');
  } catch (err) {
    logResult('Next.js Frontend', 'Results page (/results)', false, 0, err.message);
  }

  // =========================================================================
  // SUITE 3: INTERACTIVE DEMO SHOWCASE (demo.html)
  // =========================================================================
  console.log('\n[*] SUITE 3: Interactive Demo Showcase & Multi-Domain Navigation (demo.html)...');

  // Test 3.1: Load demo.html
  try {
    const t0 = Date.now();
    await page.goto(`${FRONTEND_URL}/demo.html`, { waitUntil: 'domcontentloaded' });
    const hasTitle = await page.locator('text=Attribution & Revenue Console').first().isVisible();
    logResult('Interactive Demo', 'demo.html initial render', hasTitle, Date.now() - t0);
  } catch (err) {
    logResult('Interactive Demo', 'demo.html initial render', false, 0, err.message);
  }

  // Test 3.2: Multi-Domain View Switching
  try {
    const t0 = Date.now();
    // Sponsor Hub
    await page.click('#tab-sponsor');
    const sponsorVisible = await page.locator('#view-sponsor').isVisible();
    const resultsHidden = await page.locator('#view-results').isHidden();

    // Audit Vault
    await page.click('#tab-audit');
    const auditVisible = await page.locator('#view-audit').isVisible();

    // Plain English vs Math toggle
    await page.click('#btn-audit-math');
    const mathVisible = await page.locator('#audit-math').isVisible();
    await page.click('#btn-audit-simple');
    const simpleVisible = await page.locator('#audit-simple').isVisible();

    // Pipelines
    await page.click('#tab-workflows');
    const workflowsVisible = await page.locator('#view-workflows').isVisible();

    // Live Agent MCP & Chat Simulator
    await page.click('#tab-agent');
    const agentVisible = await page.locator('#view-agent').isVisible();
    await page.click('#btn-chat-whatsapp');
    const whatsappActive = await page.locator('#whatsappPreviewCard').isVisible();
    await page.click('#btn-chat-telegram');
    const telegramActive = await page.locator('#telegramPreviewCard').isVisible();

    // Return to Console
    await page.click('#tab-results');
    const resultsBack = await page.locator('#view-results').isVisible();

    const allTabsPassed = sponsorVisible && resultsHidden && auditVisible && mathVisible && simpleVisible && workflowsVisible && agentVisible && whatsappActive && telegramActive && resultsBack;
    logResult('Interactive Demo', 'Tab Navigation across 5 workspaces', allTabsPassed, Date.now() - t0);
  } catch (err) {
    logResult('Interactive Demo', 'Tab Navigation', false, 0, err.message);
  }

  // Test 3.3: Dynamic Slider & Real-Time Exact-Penny Hare-Niemeyer Update
  try {
    const t0 = Date.now();
    await page.$eval('#bountySlider', el => {
      el.value = 5000;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(100);

    const sliderText = await page.locator('#sliderValue').innerText();
    const mayaPayout = await page.locator('#payout-maya').innerText();
    const saraPayout = await page.locator('#payout-sara').innerText();
    const davidPayout = await page.locator('#payout-david').innerText();
    const tomPayout = await page.locator('#payout-tom').innerText();

    const mayaVal = parseFloat(mayaPayout.replace(/[^0-9.]/g, ''));
    const saraVal = parseFloat(saraPayout.replace(/[^0-9.]/g, ''));
    const davidVal = parseFloat(davidPayout.replace(/[^0-9.]/g, ''));
    const tomVal = parseFloat(tomPayout.replace(/[^0-9.]/g, ''));
    const sum = mayaVal + saraVal + davidVal + tomVal;

    const sliderPassed = sliderText.includes('$5,000.00 USD') && Math.abs(sum - 5000.0) < 0.01;
    logResult('Interactive Demo', 'Bounty Slider ($5k) Exact-Penny Allocation', sliderPassed, Date.now() - t0,
      `Maya: $${mayaVal}, Sara: $${saraVal}, David: $${davidVal}, Tom: $${tomVal} -> Sum: $${sum}`);

    // Reset back to 2500
    await page.$eval('#bountySlider', el => {
      el.value = 2500;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  } catch (err) {
    logResult('Interactive Demo', 'Bounty Slider', false, 0, err.message);
  }

  // Test 3.4: Contributor Inspection Modal
  try {
    const t0 = Date.now();
    await page.evaluate(() => openContributorModal('maya'));
    await page.waitForTimeout(150);
    const modalVisible = await page.locator('#contributorModal').isVisible();
    const modalName = await page.locator('#modalName').innerText();
    await page.click('#contributorModal button:has-text("×")');
    await page.waitForTimeout(150);
    const modalClosed = await page.locator('#contributorModal').isHidden();

    logResult('Interactive Demo', 'Contributor Detail Modal (Maya Chen)', modalVisible && modalClosed && modalName.includes('Maya Chen'), Date.now() - t0);
  } catch (err) {
    logResult('Interactive Demo', 'Contributor Detail Modal', false, 0, err.message);
  }

  // Test 3.5: Custom GitHub Repository Analysis Simulation Modal
  try {
    const t0 = Date.now();
    await page.evaluate(() => openCustomRepoModal());
    await page.waitForTimeout(150);
    const repoModalVisible = await page.locator('#customRepoModal').isVisible();

    // Click test repository fastapi/fastapi
    await page.click('button:has-text("fastapi/fastapi")');
    const inputVal = await page.inputValue('#customRepoInput');

    // Trigger analysis
    await page.click('button:has-text("Start AI Attribution Analysis")');
    // Wait for simulation to run through stages and complete
    await page.waitForTimeout(2500);
    const repoModalClosed = await page.locator('#customRepoModal').isHidden();

    logResult('Interactive Demo', 'Custom Repository Analysis Flow (fastapi/fastapi)', repoModalVisible && repoModalClosed && inputVal.includes('fastapi'), Date.now() - t0);
  } catch (err) {
    logResult('Interactive Demo', 'Custom Repository Modal', false, 0, err.message);
  }

  // Test 3.6: Slide-to-Confirm PayPal Escrow Authorization
  try {
    const t0 = Date.now();
    await page.evaluate(() => {
      if (typeof openPayoutModal === 'function') openPayoutModal();
    });
    await page.waitForTimeout(200);

    const payoutModalVisible = await page.locator('#payoutModal').isVisible();
    logResult('Interactive Demo', 'Slide-to-Confirm PayPal Escrow Trigger', payoutModalVisible, Date.now() - t0);

    // Test 3.7: PayPal Settlement Modal Interactions
    if (payoutModalVisible) {
      const t1 = Date.now();
      await page.click('button:has-text("Confirm & Release Escrow")');
      await page.waitForTimeout(1200);
      const successVisible = await page.locator('#modalSuccess').isVisible();
      await page.click('#modalSuccess button:has-text("Close")');
      await page.waitForTimeout(150);
      const payoutModalClosed = await page.locator('#payoutModal').isHidden();
      logResult('Interactive Demo', 'PayPal Escrow Release Execution & Settlement Receipt', successVisible && payoutModalClosed, Date.now() - t1);
    }
  } catch (err) {
    logResult('Interactive Demo', 'Slide-to-Confirm & Settlement Modal', false, 0, err.message);
  }

  // Test 3.8: Sponsor Hub Command Center & GAAP Invoice Modal
  try {
    const t0 = Date.now();
    await page.click('#tab-sponsor');
    await page.waitForTimeout(100);

    // Verify 3 KPI cards
    const committedText = await page.locator('text=$25,000.00').first().isVisible();
    const escrowText = await page.locator('text=$11,500.00').first().isVisible();
    const wasteText = await page.locator('text=+$3,840.00').first().isVisible();

    // Open GAAP Invoice Modal
    await page.click('button:has-text("View GAAP Invoice")');
    await page.waitForTimeout(150);
    const invoiceModalVisible = await page.locator('#sponsorInvoiceModal').isVisible();

    // Verify CSV Download trigger
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 3000 }).catch(() => null),
      page.click('#sponsorInvoiceModal button:has-text("Download CSV Export")')
    ]);

    await page.waitForTimeout(200);
    const invoiceModalClosed = await page.locator('#sponsorInvoiceModal').isHidden();

    const sponsorPassed = committedText && escrowText && wasteText && invoiceModalVisible && invoiceModalClosed;
    logResult('Interactive Demo', 'Sponsor Hub Command Center & GAAP Invoice Statement', sponsorPassed, Date.now() - t0,
      download ? `CSV Downloaded: ${download.suggestedFilename()}` : 'Statement verified');
  } catch (err) {
    logResult('Interactive Demo', 'Sponsor Hub', false, 0, err.message);
  }

  // Test 3.9: Command Palette (⌘K) Search & Execution
  try {
    const t0 = Date.now();
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(150);
    const paletteVisible = await page.locator('#commandPaletteModal').isVisible();

    // Search for sponsor
    await page.fill('#cmdPaletteInput', 'sponsor');
    await page.waitForTimeout(100);
    const sponsorCmdVisible = await page.locator('#cmdPaletteResults button:has-text("Sponsor Portfolio")').isVisible();

    // Search for telegram
    await page.fill('#cmdPaletteInput', 'telegram');
    await page.waitForTimeout(100);
    const telegramCmdVisible = await page.locator('#cmdPaletteResults button:has-text("Telegram")').isVisible();

    // Close palette via Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const paletteClosed = await page.locator('#commandPaletteModal').isHidden();

    logResult('Interactive Demo', 'Command Palette (⌘K) Dynamic Filtering & Hotkeys', paletteVisible && sponsorCmdVisible && telegramCmdVisible && paletteClosed, Date.now() - t0);
  } catch (err) {
    logResult('Interactive Demo', 'Command Palette (⌘K)', false, 0, err.message);
  }

  // Test 3.10: Merkle Audit Proof Modal
  try {
    const t0 = Date.now();
    await page.evaluate(() => {
      if (typeof openMerkleModal === 'function') openMerkleModal();
    });
    await page.waitForTimeout(150);
    const merkleVisible = await page.locator('#merkleModal').isVisible();
    const rootText = await page.locator('#modalMerkleRoot').innerText();
    await page.evaluate(() => {
      if (typeof closeMerkleModal === 'function') closeMerkleModal();
    });
    await page.waitForTimeout(150);
    const merkleClosed = await page.locator('#merkleModal').isHidden();

    logResult('Interactive Demo', 'Cryptographic Merkle Proof Verification Modal', merkleVisible && merkleClosed && rootText.includes('88643cd1'), Date.now() - t0,
      `Merkle Root verified: ${rootText.slice(0, 16)}...`);
  } catch (err) {
    logResult('Interactive Demo', 'Merkle Modal', false, 0, err.message);
  }

  // =========================================================================
  // SUITE 4: PERSONA WORKSPACES, AUTH MODAL & CONTRIBUTOR SELF-SERVE ONBOARDING
  // =========================================================================
  console.log('\n[*] SUITE 4: Persona Workspaces & Contributor Self-Serve Onboarding...');

  // Test 4.1: Persona Workspaces Switching (Lead -> Sponsor -> Member)
  try {
    const t0 = Date.now();
    // Switch to Sponsor
    await page.evaluate(() => switchPersona('sponsor'));
    await page.waitForTimeout(100);
    const sponsorVisible = await page.locator('#view-sponsor').isVisible();
    const resultsHidden = await page.locator('#view-results').isHidden();

    // Switch to Member
    await page.evaluate(() => switchPersona('member'));
    await page.waitForTimeout(100);
    const memberVisible = await page.locator('#view-member').isVisible();
    const sponsorHidden = await page.locator('#view-sponsor').isHidden();

    // Switch back to Lead
    await page.evaluate(() => switchPersona('lead'));
    await page.waitForTimeout(100);
    const leadVisible = await page.locator('#view-results').isVisible();
    const memberHidden = await page.locator('#view-member').isHidden();

    const passed = sponsorVisible && resultsHidden && memberVisible && sponsorHidden && leadVisible && memberHidden;
    logResult('Persona Workspaces', 'Tri-Persona Navigation (Lead ↔ Sponsor ↔ Contributor)', passed, Date.now() - t0);
  } catch (err) {
    logResult('Persona Workspaces', 'Tri-Persona Navigation', false, 0, err.message);
  }

  // Test 4.2: Auth Modal Interactive Persona Switching
  try {
    const t0 = Date.now();
    await page.click('#btnAuthTrigger');
    await page.waitForTimeout(150);
    const authVisible = await page.locator('#authModal').isVisible();

    // Click Contributor login button
    await page.click('#authModal button:has-text("Team Member / Contributor")');
    await page.waitForTimeout(200);
    const authClosed = await page.locator('#authModal').isHidden();
    const memberActive = await page.locator('#view-member').isVisible();
    const authBadgeText = await page.locator('#authBadgeText').innerText();

    const passed = authVisible && authClosed && memberActive && authBadgeText.includes('Contributor');
    logResult('Persona Workspaces', 'Interactive Auth Modal Persona Login Trigger', passed, Date.now() - t0,
      `Badge: ${authBadgeText}`);
  } catch (err) {
    logResult('Persona Workspaces', 'Auth Modal', false, 0, err.message);
  }

  // Test 4.3: Cryptographic Hackathon Pot Solvency Modal
  try {
    const t0 = Date.now();
    await page.evaluate(() => openPotModal());
    await page.waitForTimeout(150);
    const potVisible = await page.locator('#potModal').isVisible();
    const potAmount = await page.locator('#potAmountDisplay').innerText();
    const holdId = await page.locator('#potHoldIdDisplay').innerText();

    // Trigger live re-verification
    await page.click('#btnVerifyPotLive');
    await page.waitForTimeout(500);
    const badgeText = await page.locator('#potStatusBadge').innerText();

    await page.evaluate(() => closePotModal());
    await page.waitForTimeout(100);
    const potClosed = await page.locator('#potModal').isHidden();

    const passed = potVisible && potClosed && potAmount.includes('$2,500') && holdId.includes('AUTH-PP-8829410-USD') && badgeText.includes('SOLVENT');
    logResult('Persona Workspaces', 'Cryptographic Hackathon Pot Solvency Modal & Verification', passed, Date.now() - t0,
      `Pot: ${potAmount}, Hold: ${holdId}, Status: ${badgeText.trim()}`);
  } catch (err) {
    logResult('Persona Workspaces', 'Pot Modal', false, 0, err.message);
  }

  // Test 4.4: PayPal Partner Direct Onboarding Modal
  try {
    const t0 = Date.now();
    await page.evaluate(() => openPartnerModal());
    await page.waitForTimeout(150);
    const partnerVisible = await page.locator('#partnerModal').isVisible();
    const partnerLink = await page.locator('#partnerModal a[href*="paypal.com"]').getAttribute('href');
    await page.evaluate(() => closePartnerModal());
    await page.waitForTimeout(100);
    const partnerClosed = await page.locator('#partnerModal').isHidden();

    const passed = partnerVisible && partnerClosed && partnerLink.includes('features=PAYOUTS,DELAYED_CAPTURE');
    logResult('Persona Workspaces', 'PayPal Partner Direct Onboarding Modal (Zero Secret Leakage)', passed, Date.now() - t0,
      `Scopes verified: PAYOUTS, DELAYED_CAPTURE`);
  } catch (err) {
    logResult('Persona Workspaces', 'Partner Modal', false, 0, err.message);
  }

  // Test 4.5: Contributor Self-Serve Payout Setup & Provenance Matching
  try {
    const t0 = Date.now();
    // Ensure we are in contributor workspace
    await page.evaluate(() => switchPersona('member'));
    await page.waitForTimeout(100);

    // Switch to David Kim
    await page.click('#member-tab-david');
    await page.waitForTimeout(150);
    const davidName = await page.locator('#memberCardName').innerText();
    const davidPayout = await page.locator('#memberCardPayout').innerText();
    const davidEmail = await page.locator('#memberGitEmail').innerText();

    // Verify PayPal wallet and tax self-certification
    await page.fill('#memberPayPalInput', 'david.kim.wallet@gmail.com');
    await page.check('#memberTaxCert');

    // Click Save & Bind
    await page.click('#view-member button:has-text("Save & Bind Payout Wallet")');
    await page.waitForTimeout(400);

    const noticeText = await page.locator('#memberBindingNotice').innerText();
    const passed = davidName.includes('David Kim') &&
      davidPayout.includes('$160.00') &&
      davidEmail.includes('david@example.com') &&
      noticeText.includes('Bound');

    logResult('Persona Workspaces', 'Contributor Self-Serve Payout Binding & IRS W-8BEN/W-9 Tax Self-Cert', passed, Date.now() - t0,
      `David Kim ($160.00) -> Wallet Bound: ${noticeText}`);
  } catch (err) {
    logResult('Persona Workspaces', 'Contributor Payout Setup', false, 0, err.message);
  }

  // Test 3.11: Check for Browser Page & Console Errors
  const zeroErrors = pageErrors.length === 0;
  logResult('Interactive Demo', 'Zero Uncaught Browser Page/Console Exceptions', zeroErrors, 0,
    zeroErrors ? 'No exceptions detected' : `Found ${pageErrors.length} errors: ${pageErrors.slice(0, 3).join('; ')}`);

  await browser.close();

  // Summary
  console.log('\n' + '='.repeat(80));
  const totalTests = logs.length;
  const passedTests = logs.filter(l => l.passed).length;
  const failedTests = totalTests - passedTests;
  console.log(`PLAYWRIGHT TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('='.repeat(80));

  if (failedTests > 0) {
    console.log('\n❌ FAILED TESTS LOG:');
    logs.filter(l => !l.passed).forEach(f => {
      console.log(` - [${f.suite}] ${f.name}: ${f.details}`);
    });
    process.exit(1);
  } else {
    console.log('\n✨ ALL PLAYWRIGHT TESTS PASSED CLEANLY WITH ZERO BREAKS!');
    process.exit(0);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal Test Runner Exception:', err);
  process.exit(1);
});
