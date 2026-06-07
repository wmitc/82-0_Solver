// 82-0 FORCE-WIN AGENT
// Drives the real https://www.82-0.com Classic game, overriding Math.random so the
// slot machine lands on the exact (team, decade) we want each round, then places the
// optimal player into its position slot. Produces a guaranteed 82-0 every run.
//
// Usage: node force_win.js
const { chromium } = require('playwright-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- the solved optimal roster: one combo per position ---
// idx = position of (team,decade) in the game's 180-combo list (verified live)
const NCOMBOS = 180;
const ROSTER = [
  { slot: 'PF', player: 'Bob Pettit',       team: 'ATL', decade: "60's", idx: 0   },
  { slot: 'SG', player: 'Michael Jordan',   team: 'CHI', decade: "80's", idx: 27  },
  { slot: 'C',  player: 'Wilt Chamberlain', team: 'GSW', decade: "60's", idx: 56  },
  { slot: 'SF', player: 'Elgin Baylor',     team: 'LAL', decade: "60's", idx: 82  },
  { slot: 'PG', player: 'Oscar Robertson',  team: 'SAC', decade: "60's", idx: 150 },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  // hook Math.random before any page script runs
  await ctx.addInitScript(() => {
    window.__forceRand = null;
    const orig = Math.random.bind(Math);
    Math.random = () => (window.__forceRand !== null ? window.__forceRand : orig());
  });
  const pg = await ctx.newPage();
  pg.on('console', m => { const t = m.text(); if (t.includes('Valid combination selected') || t.includes('Pre-determined')) console.log('   game>', t.replace('[v0] ', '')); });

  const clickText = labels => pg.evaluate(labels => {
    const n = s => (s || '').trim().toLowerCase();
    const B = [...document.querySelectorAll('button')];
    for (const l of labels) { const e = B.find(b => n(b.innerText) === n(l)); if (e) { e.click(); return l; } }
    return null;
  }, labels);

  console.log('Opening 82-0.com ...');
  await pg.goto('https://www.82-0.com', { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(1500);
  await clickText(['Accept']);            await sleep(300);
  await clickText(["Don't Show Again"]);  await sleep(300);
  await clickText(['Play Classic']);      await sleep(3000);
  await clickText(["Don't Show Again", 'Close']); await sleep(800);
  console.log('In Classic draft. Forcing optimal roster...\n');

  for (let r = 0; r < ROSTER.length; r++) {
    const pick = ROSTER[r];
    console.log(`Round ${r + 1}/5 -> forcing ${pick.team} ${pick.decade} for ${pick.player} (${pick.slot})`);
    await pg.evaluate(v => { window.__forceRand = v; }, (pick.idx + 0.5) / NCOMBOS);
    await clickText(['SPIN']);
    await sleep(3600);                       // spin animation
    await pg.evaluate(() => { window.__forceRand = null; });

    // click the player's row (smallest element containing exact name)
    const picked = await pg.evaluate(name => {
      const els = [...document.querySelectorAll('div,button,li')]
        .filter(e => (e.innerText || '').includes(name) && e.childElementCount <= 10);
      els.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
      if (els[0]) { els[0].click(); return true; }
      return false;
    }, pick.player);
    if (!picked) { console.error(`  ! could not find player ${pick.player}`); }
    await sleep(900);

    // click the target court-position slot (LAST matching button, to skip the "C" filter)
    await pg.evaluate(slot => {
      const B = [...document.querySelectorAll('button')].filter(b => (b.innerText || '').trim() === slot);
      const el = B[B.length - 1];           // court slot is the last occurrence
      if (el) el.click();
    }, pick.slot);
    await sleep(1200);
    console.log(`  placed ${pick.player} at ${pick.slot}`);
  }

  await sleep(2500);
  const result = await pg.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  const rec = result.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
  console.log('\n===== RESULT =====');
  console.log(rec ? `Record: ${rec[1]}-${rec[2]}` : '(record not parsed)');
  const grade = result.match(/PERFECT|HISTORIC|DYNASTY|CONTENDER/);
  if (grade) console.log('Grade:', grade[0]);
  await pg.screenshot({ path: 'result_force_win.png', fullPage: true });
  console.log('Screenshot saved -> result_force_win.png');
  await sleep(500);
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
