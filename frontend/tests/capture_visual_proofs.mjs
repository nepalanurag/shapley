import { chromium } from '@playwright/test';
import path from 'path';

const ARTIFACT_DIR = '/Users/anurag/.gemini/antigravity/brain/b9511911-26d3-498a-b019-dfd93f9930e1';
const BRAVE_PATH = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

async function capture() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: BRAVE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // 1. Desktop Context
  const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktopPage = await desktopCtx.newPage();

  // Desktop Landing
  await desktopPage.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await desktopPage.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_proof_desktop_landing.png'), fullPage: false });
  console.log('Captured desktop landing');

  // Desktop Results (AG Grid & Charts)
  await desktopPage.goto('http://127.0.0.1:3000/results?demo=true', { waitUntil: 'networkidle' });
  await desktopPage.waitForTimeout(500);
  await desktopPage.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_proof_desktop_results.png'), fullPage: false });
  console.log('Captured desktop results');

  // Open Pot Solvency Modal
  const solvencyBtn = desktopPage.locator('button:has-text("Pot Solvency")').first();
  if (await solvencyBtn.count() > 0) {
    await solvencyBtn.click();
    await desktopPage.waitForTimeout(400);
    await desktopPage.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_proof_solvency_modal.png'), fullPage: false });
    console.log('Captured solvency modal');
    await desktopPage.keyboard.press('Escape');
    await desktopPage.waitForTimeout(200);
  }

  // 2. Mobile Context (390px x 844px)
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true
  });
  const mobilePage = await mobileCtx.newPage();

  // Mobile Landing
  await mobilePage.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await mobilePage.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_proof_mobile_landing.png'), fullPage: false });
  console.log('Captured mobile landing');

  // Mobile Results
  await mobilePage.goto('http://127.0.0.1:3000/results?demo=true', { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(500);
  await mobilePage.screenshot({ path: path.join(ARTIFACT_DIR, 'visual_proof_mobile_results.png'), fullPage: false });
  console.log('Captured mobile results');

  await browser.close();
  console.log('All visual proofs captured successfully.');
}

capture().catch(err => {
  console.error('Error capturing proofs:', err);
  process.exit(1);
});
