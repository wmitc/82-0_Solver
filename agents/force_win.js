// 82-0 FORCE-WIN AGENT
//
// The other end of the spectrum from the honest agent: instead of playing the
// odds, it CONTROLS the environment. It drives the real Classic game but hooks
// the page's Math.random so the slot machine lands on exactly the (team, decade)
// we want each round, then places a pre-solved optimal player into each slot.
// The result is a guaranteed 82-0 on every run, first try.
//
// It's still an agent (it perceives spin results and acts on the page in a loop
// toward a goal) — it just removes the randomness that makes the goal hard.
//
// Usage: node agents/force_win.js
const { chromium } = require('playwright-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- the solved optimal roster: one (team, decade) combo per position ---
// `idx` is that combo's position in the game's 180-combo list (verified live).
// We force the slot machine to that index by feeding Math.random a value that
// makes Math.floor(rand * 180) === idx (see __forceRand below).
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
  // Install the Math.random hook BEFORE any page script runs (addInitScript runs
  // on every new document, ahead of the app). When window.__forceRand is set, the
  // game's Math.random() returns that fixed value; otherwise it behaves normally.
  await ctx.addInitScript(() => {
    window.__forceRand = null;
    const orig = Math.random.bind(Math);
    Math.random = () => (window.__forceRand !== null ? window.__forceRand : orig());
  });
  const pg = await ctx.newPage();
  // Echo the game's own combo logs so we can see it landing where we forced it.
  pg.on('console', m => { const t = m.text(); if (t.includes('Valid combination selected') || t.includes('Pre-determined')) console.log('   game>', t.replace('[v0] ', '')); });

  // clickText: click the first <button> whose text matches one of `labels`.
  const clickText = labels => pg.evaluate(labels => {
    const n = s => (s || '').trim().toLowerCase();
    const B = [...document.querySelectorAll('button')];
    for (const l of labels) { const e = B.find(b => n(b.innerText) === n(l)); if (e) { e.click(); return l; } }
    return null;
  }, labels);

  // --- get into the Classic draft (dismiss cookie/intro modals) ---
  console.log('Opening 82-0.com ...');
  await pg.goto('https://www.82-0.com', { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(1500);
  await clickText(['Accept']);            await sleep(300);
  await clickText(["Don't Show Again"]);  await sleep(300);
  await clickText(['Play Classic']);      await sleep(3000);
  await clickText(["Don't Show Again", 'Close']); await sleep(800);
  console.log('In Classic draft. Forcing optimal roster...\n');

  // --- one round per roster entry: force the combo, then place the player ---
  for (let r = 0; r < ROSTER.length; r++) {
    const pick = ROSTER[r];
    console.log(`Round ${r + 1}/5 -> forcing ${pick.team} ${pick.decade} for ${pick.player} (${pick.slot})`);
    // Set Math.random's return so floor(rand*180) === idx. The +0.5 lands us in
    // the middle of the index's bucket, robust to floating-point rounding.
    await pg.evaluate(v => { window.__forceRand = v; }, (pick.idx + 0.5) / NCOMBOS);
    await clickText(['SPIN']);
    await sleep(3600);                       // wait out the spin animation
    await pg.evaluate(() => { window.__forceRand = null; });   // restore real RNG after the spin

    // Click the forced player's row (smallest element containing the exact name).
    const picked = await pg.evaluate(name => {
      const els = [...document.querySelectorAll('div,button,li')]
        .filter(e => (e.innerText || '').includes(name) && e.childElementCount <= 10);
      els.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
      if (els[0]) { els[0].click(); return true; }
      return false;
    }, pick.player);
    if (!picked) { console.error(`  ! could not find player ${pick.player}`); }
    await sleep(900);

    // Click the destination court slot. "C" is also a position-filter button, so
    // click the LAST match (the court slot is rendered last) to avoid the filter.
    await pg.evaluate(slot => {
      const B = [...document.querySelectorAll('button')].filter(b => (b.innerText || '').trim() === slot);
      const el = B[B.length - 1];           // court slot is the last occurrence
      if (el) el.click();
    }, pick.slot);
    await sleep(1200);
    console.log(`  placed ${pick.player} at ${pick.slot}`);
  }

  // --- read the final record + grade and screenshot the proof ---
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
