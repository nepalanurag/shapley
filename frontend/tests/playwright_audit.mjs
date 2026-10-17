import { chromium } from '@playwright/test';

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
    const inv = data.invoice || data;
    const passed = res.status() === 200 &&
      (inv.invoice_number || data.invoice_number) &&
      (inv.grant_amount_usd || inv.total_committed_usd || data.total_committed_usd);
    logResult('Backend API', 'GET /api/sponsor/invoice GAAP Accounting Reconciliation', passed, Date.now() - t0,
      `Invoice: ${inv.invoice_number || data.invoice_number}, Grant: $${inv.grant_amount_usd || inv.total_committed_usd}`);
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
    const holdId = pot.paypal_auth_id || pot.paypal_hold_id || pot.authorization_id;
    const passed = res.status() === 200 &&
      data.status === 'SUCCESS' &&
      pot.pot_status === 'SOLVENT_ESCROW_HELD' &&
      holdId &&
      pot.prize_pool_usd === 2500.0;
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
    await page.goto(`${FRONTEND_URL}/results?demo=true`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Maya Chen', { timeout: 10000 });
    const hasMaya = await page.locator('text=Maya Chen').first().isVisible();
    const hasPool = await page.locator('text=$1000').or(page.locator('text=$1,000')).first().isVisible();
    logResult('Next.js Frontend', 'Results page (/results?demo=true) data binding', hasMaya && hasPool, Date.now() - t0,
      'Maya Chen and $1,000 USD pool verified');
  } catch (err) {
    logResult('Next.js Frontend', 'Results page (/results)', false, 0, err.message);
  }

  // =========================================================================
  // SUITE 3: INTERACTIVE RESULTS CONSOLE & MODALS
  // =========================================================================
  console.log('\n[*] SUITE 3: Interactive Results Console & Modals...');

  // Test 3.1: Bounty Pool Simulator Slider
  try {
    const t0 = Date.now();
    const slider = page.locator('input[type="range"]');
    await slider.fill('5000');
    await slider.dispatchEvent('change');
    await page.waitForTimeout(200);

    const poolText = await page.locator('text=$5,000.00 USD').first().isVisible();
    logResult('Results Console', 'Bounty Pool Simulator Slider ($5,000 USD)', poolText, Date.now() - t0);

    // Reset back to 1000
    await slider.fill('1000');
    await slider.dispatchEvent('change');
    await page.waitForTimeout(200);
  } catch (err) {
    logResult('Results Console', 'Bounty Pool Simulator Slider', false, 0, err.message);
  }

  // Test 3.2: Cryptographic Merkle Root Proof Modal
  try {
    const t0 = Date.now();
    await page.click('button:has-text("Merkle Root Verified")');
    await page.waitForTimeout(200);

    const merkleModal = page.locator('text=Cryptographic Merkle Audit Proof');
    const isMerkleVisible = await merkleModal.isVisible();
    const hasRoot = await page.locator('text=88643cd1fe4e').isVisible();

    await page.click('button:has-text("Done")');
    await page.waitForTimeout(200);
    const isMerkleClosed = await merkleModal.isHidden();

    logResult('Results Console', 'Cryptographic Merkle Proof Modal (RFC 6962 SHA-256)', isMerkleVisible && hasRoot && isMerkleClosed, Date.now() - t0);
  } catch (err) {
    logResult('Results Console', 'Merkle Proof Modal', false, 0, err.message);
  }

  // Test 3.3: Chat Alerts & Webhooks Modal
  try {
    const t0 = Date.now();
    await page.click('button:has-text("Chat Alerts")');
    await page.waitForTimeout(200);

    const isChatModalVisible = await page.locator('text=Team Chat Alerts & Webhooks').isVisible();

    // Click Telegram tab
    await page.click('button:has-text("Telegram Bot")');
    await page.waitForTimeout(100);
    const hasTelegramPayload = await page.locator('pre:has-text("shapley_updates")').isVisible();

    // Click WhatsApp tab
    await page.click('button:has-text("WhatsApp Cloud")');
    await page.waitForTimeout(100);
    const hasWhatsappPayload = await page.locator('pre:has-text("whatsapp")').isVisible();

    // Close modal
    await page.click('button:has-text("Close")');
    await page.waitForTimeout(200);
    const isChatModalClosed = await page.locator('text=Team Chat Alerts & Webhooks').isHidden();

    logResult('Results Console', 'Chat Alerts Modal (Telegram, WhatsApp, Slack, Discord)', isChatModalVisible && hasTelegramPayload && hasWhatsappPayload && isChatModalClosed, Date.now() - t0);
  } catch (err) {
    logResult('Results Console', 'Chat Alerts Modal', false, 0, err.message);
  }

  // Test 3.4: GitHub Action CI/CD Workflow Modal
  try {
    const t0 = Date.now();
    await page.click('button:has-text("CI/CD Action")');
    await page.waitForTimeout(200);

    const isActionModalVisible = await page.locator('text=Automate via GitHub Actions').isVisible();
    const hasYaml = await page.locator('pre:has-text("Shapley Release Bounty")').isVisible();

    await page.locator('div.modal-content button:has-text("×")').click();
    await page.waitForTimeout(200);
    const isActionModalClosed = await page.locator('text=Automate via GitHub Actions').isHidden();

    logResult('Results Console', 'CI/CD GitHub Action Automation Modal', isActionModalVisible && hasYaml && isActionModalClosed, Date.now() - t0);
  } catch (err) {
    logResult('Results Console', 'CI/CD Action Modal', false, 0, err.message);
  }

  // Test 3.5: Command Palette (⌘K)
  try {
    const t0 = Date.now();
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(200);

    const input = page.locator('input[placeholder*="Search actions"]');
    const isPaletteOpen = await input.isVisible();

    // Filter by ESCROW
    await input.fill('ESCROW');
    await page.waitForTimeout(100);
    const hasEscrowResult = await page.locator('text=Authorize PayPal Escrow Release').isVisible();

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const isPaletteClosed = await input.isHidden();

    logResult('Results Console', 'Command Palette (⌘K) Hotkey & Dynamic Filtering', isPaletteOpen && hasEscrowResult && isPaletteClosed, Date.now() - t0);
  } catch (err) {
    logResult('Results Console', 'Command Palette', false, 0, err.message);
  }

  // Test 3.6: Methodology & Axiomatic Proofs Dropdown
  try {
    const t0 = Date.now();
    await page.click('button:has-text("Methodology & Axiomatic Proofs")');
    await page.waitForTimeout(200);

    const mathVisible = await page.locator('text=The Marginal Contribution Axiom').isVisible();
    // Switch to Math Proofs tab
    await page.click('button:has-text("Math Proofs")');
    await page.waitForTimeout(150);

    const formulaVisible = await page.locator('text=Efficiency').isVisible() && await page.locator('text=Monotonicity').isVisible();

    // Close methodology
    await page.click('button:has-text("Hide Methodology")');
    await page.waitForTimeout(200);
    const mathHidden = await page.locator('text=The Marginal Contribution Axiom').isHidden();

    logResult('Results Console', 'Methodology & Axiomatic Proofs (Lloyd Shapley Game Theory)', mathVisible && formulaVisible && mathHidden, Date.now() - t0);
  } catch (err) {
    logResult('Results Console', 'Methodology Explainer', false, 0, err.message);
  }

  // =========================================================================
  // SUITE 4: TRI-PERSONA WORKSPACES & CONTRIBUTOR ONBOARDING
  // =========================================================================
  console.log('\n[*] SUITE 4: Tri-Persona Workspaces & Contributor Onboarding...');

  // Test 4.1: Switch to Business Sponsor Persona
  try {
    const t0 = Date.now();
    await page.click('button:has-text("Business Sponsor")');
    await page.waitForTimeout(300);

    const hasSponsorHeader = await page.locator('text=Sponsor Portfolio & Grant Command Center').isVisible();
    const hasCommitted = await page.locator('text=$25,000.00').first().isVisible();
    const hasEscrow = await page.locator('text=$11,500.00').first().isVisible();
    const hasWaste = await page.locator('text=+$3,840.00').first().isVisible();

    logResult('Persona Workspaces', 'Business Sponsor Workspace & Portfolio KPIs', hasSponsorHeader && hasCommitted && hasEscrow && hasWaste, Date.now() - t0);
  } catch (err) {
    logResult('Persona Workspaces', 'Business Sponsor Workspace', false, 0, err.message);
  }

  // Test 4.2: Sponsor GAAP Invoice Modal
  try {
    const t0 = Date.now();
    await page.click('button:has-text("View GAAP Invoice")');
    await page.waitForTimeout(300);

    const hasInvoiceModal = await page.locator('text=Corporate Grant Invoice').isVisible();
    const hasInvoiceNumber = await page.locator('text=INV').first().isVisible();

    await page.click('div.bg-zinc-950 button:has-text("Done")');
    await page.waitForTimeout(200);
    const isInvoiceClosed = await page.locator('text=Corporate Grant Invoice').isHidden();

    logResult('Persona Workspaces', 'Sponsor GAAP Invoice & Accounting Reconciliation', hasInvoiceModal && hasInvoiceNumber && isInvoiceClosed, Date.now() - t0);
  } catch (err) {
    logResult('Persona Workspaces', 'GAAP Invoice Modal', false, 0, err.message);
  }

  // Test 4.3: Switch to Contributor Persona
  try {
    const t0 = Date.now();
    await page.click('button:has-text("Contributor")');
    await page.waitForTimeout(300);

    const hasPortalHeader = await page.locator('text=Contributor Fair Share Payout Portal').isVisible();
    const hasMayaCard = await page.locator('text=Maya Chen').first().isVisible();

    logResult('Persona Workspaces', 'Contributor Portal & Self-Serve Workspace', hasPortalHeader && hasMayaCard, Date.now() - t0);
  } catch (err) {
    logResult('Persona Workspaces', 'Contributor Portal', false, 0, err.message);
  }

  // Test 4.4: Contributor Git Provenance & Tax Self-Certification
  try {
    const t0 = Date.now();
    // Select David
    await page.locator('button:has-text("David")').first().click();
    await page.waitForTimeout(200);

    const hasDavidSelected = await page.locator('text=David Kim').first().isVisible();

    // Fill wallet email & submit
    const emailInput = page.locator('input[type="email"]');
    await emailInput.fill('david.kim.wallet@gmail.com');

    // Ensure tax checkbox is checked
    const checkbox = page.locator('input[type="checkbox"]');
    await checkbox.check();

    // Click claim button
    await page.click('button:has-text("Sign & Link PayPal Wallet")');
    await page.waitForTimeout(400);

    const successNotice = await page.locator('text=Wallet successfully bound!').isVisible();
    logResult('Persona Workspaces', 'Contributor Self-Serve Payout & IRS Tax Self-Cert', hasDavidSelected && successNotice, Date.now() - t0);
  } catch (err) {
    logResult('Persona Workspaces', 'Contributor Self-Cert', false, 0, err.message);
  }

  // Test 4.5: Cryptographic Hackathon Pot Solvency Modal
  try {
    const t0 = Date.now();
    await page.click('button:has-text("Hackathon Pot Solvency ($2,500)")');
    await page.waitForTimeout(300);

    const isPotModalVisible = await page.locator('text=Hackathon Prize Pot Solvency Proof').isVisible();
    const hasPotHold = await page.locator('text=AUTH-PP-8829410-USD').isVisible();
    const hasStatus = await page.locator('text=SOLVENT_ESCROW_HELD').isVisible();

    // Re-verify live solvency
    await page.click('button:has-text("Re-Verify Live Solvency")');
    await page.waitForTimeout(400);

    // Close modal
    await page.click('button:has-text("Done")');
    await page.waitForTimeout(200);
    const isPotClosed = await page.locator('text=Hackathon Prize Pot Solvency Proof').isHidden();

    logResult('Persona Workspaces', 'Cryptographic Hackathon Pot Solvency Modal & Live API Re-Verify', isPotModalVisible && hasPotHold && hasStatus && isPotClosed, Date.now() - t0);
  } catch (err) {
    logResult('Persona Workspaces', 'Pot Solvency Modal', false, 0, err.message);
  }

  // Switch back to Team Lead
  await page.click('button:has-text("Team Lead")');
  await page.waitForTimeout(200);

  // =========================================================================
  // SUITE 5: AG GRID & AG CHARTS SPONSOR PRIZE-WORTHY INTEGRATION
  // =========================================================================
  console.log('\n[*] SUITE 5: AG Grid & AG Charts Sponsor Prize-Worthy Integration (4 Phases)...');

  // Test 5.1: In-Cell Marginal Consistency Sparklines (Phase 2)
  try {
    const t0 = Date.now();
    const gridVisible = await page.locator('.ag-theme-quartz').first().isVisible();
    const sparklines = page.locator('.ag-theme-quartz svg polyline');
    const sparklineCount = await sparklines.count();

    logResult('AG Grid & Charts', 'Phase 2: In-Cell Marginal Consistency Sparklines', gridVisible && sparklineCount >= 4, Date.now() - t0,
      `Sparklines found: ${sparklineCount}`);
  } catch (err) {
    logResult('AG Grid & Charts', 'Phase 2 Sparklines', false, 0, err.message);
  }

  // Test 5.2: Baseline Comparison Toggle & Animated Re-sorting (Phase 4)
  try {
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Lines Changed', exact: true }).click();
    await page.waitForTimeout(300);
    const locNote = await page.locator('text=Rewards formatting/Prettier churn').isVisible();

    await page.getByRole('button', { name: 'Commit Count', exact: true }).click();
    await page.waitForTimeout(300);
    const commitNote = await page.locator('text=Rewards micro-commit fragmentation').isVisible();

    await page.getByRole('button', { name: 'AI Shapley', exact: true }).click();
    await page.waitForTimeout(300);
    const shapleyNote = await page.locator('text=Game-theoretic axiomatic fairness').isVisible();

    logResult('AG Grid & Charts', 'Phase 4: Baseline Comparison Toggle (AI Shapley vs LOC vs Commits)', locNote && commitNote && shapleyNote, Date.now() - t0);
  } catch (err) {
    logResult('AG Grid & Charts', 'Phase 4 Baseline Toggle', false, 0, err.message);
  }

  // Test 5.3: Coalition Explorer Grid (Phase 3: 2^N Subsets)
  try {
    const t0 = Date.now();
    await page.click('button:has-text("Coalition Explorer")');
    await page.waitForTimeout(300);

    const hasSubsetsNote = await page.locator('text=2^4 = 16 mathematical coalitions').isVisible();
    const grandCoalition = await page.locator('span:has-text("100.0")').first().isVisible();

    // Switch back to Contributors
    await page.click('button:has-text("Contributors (N=4)")');
    await page.waitForTimeout(200);
    const contributorsBack = await page.locator('.ag-theme-quartz').first().isVisible();

    logResult('AG Grid & Charts', 'Phase 3: Coalition Explorer Grid (All 16 2^N Subsets & Synergies)', hasSubsetsNote && grandCoalition && contributorsBack, Date.now() - t0);
  } catch (err) {
    logResult('AG Grid & Charts', 'Phase 3 Coalition Explorer', false, 0, err.message);
  }

  // Test 5.4: Grid-Chart Cross-Filtering & Contributor Deep Dive (Phase 1)
  try {
    const t0 = Date.now();
    // Click Maya Chen row in AG Grid
    await page.locator('.ag-row:has-text("Maya Chen")').first().click();
    await page.waitForTimeout(300);

    const hasDeepDive = await page.locator('h2:has-text("Maya Chen")').first().isVisible();
    const hasASTMetrics = await page.locator('text=Physical Code Signals & AST Analysis').isVisible();

    await page.click('button:has-text("Close Inspection")');
    await page.waitForTimeout(200);
    const isDeepDiveClosed = await page.locator('text=Physical Code Signals & AST Analysis').isHidden();

    logResult('AG Grid & Charts', 'Phase 1: Grid-Chart Cross-Filtering & Contributor Forensic Deep Dive', hasDeepDive && hasASTMetrics && isDeepDiveClosed, Date.now() - t0);
  } catch (err) {
    logResult('AG Grid & Charts', 'Phase 1 Cross-Filtering', false, 0, err.message);
  }

  // Test 5.5: Zero Browser Exceptions & Next.js Performance
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
