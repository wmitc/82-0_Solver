// Verify the skip buttons. Spin, then click "Team" (expected skip-team) and watch
// console: a skip should lock the OTHER axis, exclude the current value, and log a
// new combination. Then click "Era" and watch again. Confirms labels + semantics
// and whether the skip buttons disable after one use.
const { chromium } = require('playwright-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const pg = await ctx.newPage();
  pg.on('console', m => { const t = m.text(); if (t.includes('[v0]')) console.log('  >', t.replace('[v0] ', '')); });

  const clickText = labels => pg.evaluate(labels => {
    const n = s => (s || '').trim().toLowerCase();
    const B = [...document.querySelectorAll('button')];
    for (const l of labels) { const e = B.find(b => n(b.innerText) === n(l) && !b.disabled); if (e) { e.click(); return l; } }
    return null;
  }, labels);
  const buttons = () => pg.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => ((b.innerText || '').trim().replace(/\s+/g, ' ')) + (b.disabled ? '(disabled)' : '')).filter(Boolean));
  const header = () => pg.evaluate(() => {
    const e = [...document.querySelectorAll('*')].find(e => /Round \d\/5/.test(e.innerText || '') && e.childElementCount <= 4);
    return e ? (e.innerText || '').replace(/\s+/g, ' ').slice(0, 60) : '(no header)';
  });

  await pg.goto('https://www.82-0.com', { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(1500);
  await clickText(['Accept']); await sleep(300);
  await clickText(["Don't Show Again"]); await sleep(300);
  await clickText(['Play Classic']); await sleep(3000);
  await clickText(["Don't Show Again", 'Close']); await sleep(800);

  console.log('\n=== SPIN ===');
  await clickText(['SPIN']); await sleep(4000);
  console.log('header:', await header());
  console.log('buttons:', JSON.stringify(await buttons()));

  console.log('\n=== click "Team" (expect skip-team) ===');
  console.log('clicked:', await clickText(['Team', 'Skip Team']));
  await sleep(4000);
  console.log('header:', await header());
  console.log('buttons:', JSON.stringify(await buttons()));

  console.log('\n=== click "Era" (expect skip-era) ===');
  console.log('clicked:', await clickText(['Era', 'Skip Era', 'Decade']));
  await sleep(4000);
  console.log('header:', await header());
  console.log('buttons:', JSON.stringify(await buttons()));

  await pg.screenshot({ path: 'shot_skip_recon.png', fullPage: true });
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
