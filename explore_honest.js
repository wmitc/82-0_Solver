// Live recon for the honest-play driver. Does NOT override Math.random.
// Spins once for real, captures the game's console logs + DOM so we learn the
// exact selectors/labels the honest agent needs: how the offered (team, decade)
// is surfaced, the skip-button labels, the player-row format, and the replay
// ("Build Another") button. Writes findings to console + shot_honest_recon.png.
//
// Usage: node explore_honest.js
const { chromium } = require('playwright-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const pg = await ctx.newPage();
  const logs = [];
  pg.on('console', m => { const t = m.text(); if (t.includes('[v0]')) { logs.push(t); console.log('  console>', t); } });

  const clickText = labels => pg.evaluate(labels => {
    const n = s => (s || '').trim().toLowerCase();
    const B = [...document.querySelectorAll('button')];
    for (const l of labels) { const e = B.find(b => n(b.innerText) === n(l)); if (e) { e.click(); return l; } }
    return null;
  }, labels);
  const buttons = () => pg.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim().replace(/\s+/g, ' ')).filter(Boolean));

  console.log('Opening 82-0.com ...');
  await pg.goto('https://www.82-0.com', { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(1500);
  await clickText(['Accept']); await sleep(300);
  await clickText(["Don't Show Again"]); await sleep(300);
  await clickText(['Play Classic']); await sleep(3000);
  await clickText(["Don't Show Again", 'Close']); await sleep(800);

  console.log('\n--- BUTTONS before spin ---'); console.log(JSON.stringify(await buttons()));

  console.log('\n--- SPIN (real random) ---');
  await clickText(['SPIN']); await sleep(4000);

  const state = await pg.evaluate(() => {
    const txt = el => (el.innerText || '').trim().replace(/\s+/g, ' ');
    // header-ish region: short elements with team/decade-looking text
    const shorts = [...document.querySelectorAll('h1,h2,h3,p,span,div')]
      .filter(e => e.childElementCount <= 2 && txt(e).length > 0 && txt(e).length < 40)
      .map(txt);
    return {
      bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
      shorts: [...new Set(shorts)].slice(0, 60),
    };
  });
  console.log('\n--- BODY (first 600 chars) ---'); console.log(state.bodyHead);
  console.log('\n--- SHORT TEXTS (team/decade candidates) ---'); console.log(JSON.stringify(state.shorts));
  console.log('\n--- BUTTONS after spin (skip labels, player names) ---'); console.log(JSON.stringify(await buttons()));
  console.log('\n--- CONSOLE LOGS captured ---'); console.log(JSON.stringify(logs, null, 1));

  await pg.screenshot({ path: 'shot_honest_recon.png', fullPage: true });
  console.log('\nScreenshot -> shot_honest_recon.png');
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
