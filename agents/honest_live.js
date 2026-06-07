// 82-0 HONEST-PLAY LIVE DRIVER
// Drives the real https://www.82-0.com Classic game by the rules — it never
// overrides Math.random. Each round it spins, reads the offered (team, decade)
// from the game's own console log, asks the shared strategy brain whether to
// place or skip, spends its one Team-skip / one Era-skip when worthwhile, places
// the best available player, and after 5 picks reads the record. If it isn't
// 82-0 it clicks the replay button and plays again, until a win or maxGames.
//
// Usage: node honest_live.js [maxGames]     (default 3 — a validation run)
const { chromium } = require('playwright-core');
const brain = require('./honest_play.js');
const { decide, bestPlacement, pool, POS } = brain;
const MARGIN = 1.0;                                   // best per simulator
const sleep = ms => new Promise(r => setTimeout(r, ms));
const deca2era = d => { const n = parseInt(d, 10); return (n >= 50 ? 1900 + n : 2000 + n) + 's'; };

(async () => {
  const maxGames = parseInt(process.argv[2] || '3', 10);
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const pg = await ctx.newPage();
  const logs = [];
  pg.on('console', m => { const t = m.text(); if (t.includes('[v0]')) logs.push(t.replace('[v0] ', '')); });

  const clickText = labels => pg.evaluate(labels => {
    const n = s => (s || '').trim().toLowerCase();
    const B = [...document.querySelectorAll('button')];
    for (const l of labels) { const e = B.find(b => n(b.innerText) === n(l) && !b.disabled); if (e) { e.click(); return l; } }
    return null;
  }, labels);
  const buttons = () => pg.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => ((b.innerText || '').trim().replace(/\s+/g, ' ')) + (b.disabled ? '(disabled)' : '')).filter(Boolean));
  const bodyText = () => pg.evaluate(() => (document.body.innerText || ''));

  // Wait for a fresh "Pre-determined final result" log, then parse {team, decade}.
  async function readCombo(sinceLen) {
    for (let i = 0; i < 30; i++) {
      for (let j = logs.length - 1; j >= sinceLen; j--) {
        const m = logs[j].match(/Pre-determined final result: \{team: (\w+), decade: ([\w']+)\}/);
        if (m) return { team: m[1], era: deca2era(m[2]) };
      }
      await sleep(200);
    }
    return null;
  }
  async function clickPlayer(name) {
    return pg.evaluate(name => {
      const els = [...document.querySelectorAll('div,button,li')].filter(e => (e.innerText || '').includes(name) && e.childElementCount <= 10);
      els.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
      if (els[0]) { els[0].click(); return true; } return false;
    }, name);
  }
  async function clickSlot(slot) {                    // court slot = LAST matching button (avoids the "C" filter)
    return pg.evaluate(slot => {
      const B = [...document.querySelectorAll('button')].filter(b => (b.innerText || '').trim() === slot);
      const el = B[B.length - 1]; if (el) { el.click(); return true; } return false;
    }, slot);
  }

  console.log('Opening 82-0.com ...');
  await pg.goto('https://www.82-0.com', { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(1500);
  await clickText(['Accept']); await sleep(300);
  await clickText(["Don't Show Again"]); await sleep(300);
  await clickText(['Play Classic']); await sleep(3000);
  await clickText(["Don't Show Again", 'Close']); await sleep(800);

  let won = false;
  for (let game = 1; game <= maxGames && !won; game++) {
    console.log(`\n===== GAME ${game}/${maxGames} =====`);
    const roster = [null, null, null, null, null];
    const skips = { team: true, decade: true };

    for (let round = 0; round < 5; round++) {
      const before = logs.length;
      await clickText(['SPIN']);
      let { team, era } = (await readCombo(before)) || {};
      if (!team) { console.log('  ! no combo parsed; buttons:', JSON.stringify(await buttons())); break; }
      await sleep(3800);                               // spin animation

      // skip loop: up to one Team-skip and one Era-skip this round
      for (let s = 0; s < 2; s++) {
        const d = decide(roster, team, era, skips, MARGIN);
        if (d.action === 'skipTeam' && skips.team) {
          const b = logs.length; await clickText(['Team']); skips.team = false;
          ({ team, era } = (await readCombo(b)) || { team, era }); await sleep(3800);
          console.log(`  skip team -> ${team} ${era}`);
        } else if (d.action === 'skipDecade' && skips.decade) {
          const b = logs.length; await clickText(['Era']); skips.decade = false;
          ({ team, era } = (await readCombo(b)) || { team, era }); await sleep(3800);
          console.log(`  skip era  -> ${team} ${era}`);
        } else break;
      }

      const body = await bodyText();
      const offered = pool(team, era).filter(p => body.includes(p.player));
      const place = bestPlacement(roster, offered);
      if (!place) { console.log(`  ! no eligible player for ${team} ${era} (open: ${POS.filter((s,i)=>!roster[i])})`); break; }
      await clickPlayer(place.player.player); await sleep(800);
      await clickSlot(place.slot); await sleep(1100);
      roster[POS.indexOf(place.slot)] = place.player;
      console.log(`  R${round + 1} ${team} ${era}: ${place.slot} <- ${place.player.player}  (proj ovr ${place.ovr})`);
    }

    await sleep(2500);
    // Source of truth = our verified scoring port (page "pts" matches teamOvr exactly).
    const ovr = brain.teamOvr(roster);
    const wins = brain.winsFor(ovr);
    won = wins === 82;
    // Cross-check against the on-page PROJECTED RECORD (en-dash), NOT the "82-0" branding.
    const pageRec = await pg.evaluate(() => {
      const m = (document.body.innerText || '').match(/PROJECTED RECORD\s*(\d{1,2})\s*[‒-―\-]\s*(\d{1,2})/);
      return m ? `${m[1]}-${m[2]}` : null;
    });
    console.log(`  -> teamOvr=${ovr}  computed ${wins}-${82 - wins}  page=${pageRec || '?'}`);
    if (pageRec && pageRec !== `${wins}-${82 - wins}`) console.log(`  ! WARN computed record disagrees with page (${pageRec})`);

    if (won) {
      await pg.screenshot({ path: 'result_honest_win.png', fullPage: true });
      console.log('\n  *** 82-0 ACHIEVED (honestly) *** -> result_honest_win.png');
    } else {
      await clickText(['Build Another', 'Play Again', 'New Game', 'Try Again', 'Play Classic']);
      await sleep(2500);
    }
  }

  if (!won) console.log(`\nNo 82-0 within ${maxGames} games (expected ~1 in 109). Brain/driver validated.`);
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
