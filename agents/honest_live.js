// 82-0 HONEST-PLAY LIVE DRIVER
//
// The honest agent embodied: it drives the real https://www.82-0.com Classic
// game through a headless browser, by the rules — it never overrides Math.random.
// It imports the strategy "brain" from honest_play.js and runs the classic
// agent loop: PERCEIVE the spun (team, era), DECIDE place-or-skip, ACT (click),
// repeat for 5 rounds, read the record, and replay until a win or maxGames.
//
// Why this is ~millions of times slower than the offline simulator: almost all
// the time here is real wall-clock waiting — page loads, ~3.8s spin animations,
// DOM render delays — not computation. One live game takes ~30-40s; the sim runs
// a game in microseconds.
//
// Usage: node agents/honest_live.js [maxGames]   (default 3 — a quick validation run)
const { chromium } = require('playwright-core');
const brain = require('./honest_play.js');            // the shared strategy/brain
const { decide, bestPlacement, pool, POS } = brain;
const MARGIN = 1.0;                                    // skip threshold; best per simulator
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The game logs decades as "90's"/"60's"; the DB uses "1990s"/"1960s". Map between
// them: a two-digit decade >= 50 is 1900s, otherwise 2000s ("00's" -> 2000s).
const deca2era = d => { const n = parseInt(d, 10); return (n >= 50 ? 1900 + n : 2000 + n) + 's'; };

(async () => {
  const maxGames = parseInt(process.argv[2] || '3', 10);   // how many full games to attempt
  // Launch a headless Chromium. (executablePath points at the system browser.)
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const pg = await ctx.newPage();
  // The site console-logs its state with a "[v0]" prefix. We capture those lines
  // — they're how we PERCEIVE which combo the slot machine actually landed on.
  const logs = [];
  pg.on('console', m => { const t = m.text(); if (t.includes('[v0]')) logs.push(t.replace('[v0] ', '')); });

  // --- small DOM helpers (run inside the page) ---
  // clickText: click the first enabled <button> whose text matches one of `labels`.
  const clickText = labels => pg.evaluate(labels => {
    const n = s => (s || '').trim().toLowerCase();
    const B = [...document.querySelectorAll('button')];
    for (const l of labels) { const e = B.find(b => n(b.innerText) === n(l) && !b.disabled); if (e) { e.click(); return l; } }
    return null;
  }, labels);
  // buttons: list current button labels (with a (disabled) marker) — for debugging.
  const buttons = () => pg.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => ((b.innerText || '').trim().replace(/\s+/g, ' ')) + (b.disabled ? '(disabled)' : '')).filter(Boolean));
  const bodyText = () => pg.evaluate(() => (document.body.innerText || ''));

  // readCombo: after a spin/skip, wait for a fresh "Pre-determined final result"
  // console line (only looking at logs added since index `sinceLen`) and parse
  // the resolved {team, decade} out of it. Returns {team, era} or null on timeout.
  async function readCombo(sinceLen) {
    for (let i = 0; i < 30; i++) {                  // poll up to ~6s
      for (let j = logs.length - 1; j >= sinceLen; j--) {
        const m = logs[j].match(/Pre-determined final result: \{team: (\w+), decade: ([\w']+)\}/);
        if (m) return { team: m[1], era: deca2era(m[2]) };
      }
      await sleep(200);
    }
    return null;
  }
  // clickPlayer: click a player's row by name. The name appears in many nested
  // elements, so pick the SMALLEST matching one (the tight row, not a big wrapper).
  async function clickPlayer(name) {
    return pg.evaluate(name => {
      const els = [...document.querySelectorAll('div,button,li')].filter(e => (e.innerText || '').includes(name) && e.childElementCount <= 10);
      els.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
      if (els[0]) { els[0].click(); return true; } return false;
    }, name);
  }
  // clickSlot: click the destination court slot. "C" also appears as a position
  // FILTER button, so we click the LAST button with that exact text — the court
  // slot is rendered last — to avoid hitting the filter.
  async function clickSlot(slot) {
    return pg.evaluate(slot => {
      const B = [...document.querySelectorAll('button')].filter(b => (b.innerText || '').trim() === slot);
      const el = B[B.length - 1]; if (el) { el.click(); return true; } return false;
    }, slot);
  }

  // --- get into the Classic draft (dismiss cookie/intro modals) ---
  console.log('Opening 82-0.com ...');
  await pg.goto('https://www.82-0.com', { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(1500);
  await clickText(['Accept']); await sleep(300);
  await clickText(["Don't Show Again"]); await sleep(300);
  await clickText(['Play Classic']); await sleep(3000);
  await clickText(["Don't Show Again", 'Close']); await sleep(800);

  // --- outer loop: play full games until we win or run out of attempts ---
  let won = false;
  for (let game = 1; game <= maxGames && !won; game++) {
    console.log(`\n===== GAME ${game}/${maxGames} =====`);
    const roster = [null, null, null, null, null];
    const skips = { team: true, decade: true };   // one team-skip + one era-skip per game

    // --- inner loop: 5 rounds, one player placed per round ---
    for (let round = 0; round < 5; round++) {
      const before = logs.length;                  // marker so readCombo only sees new logs
      await clickText(['SPIN']);                    // ACT: spin the slot machine
      let { team, era } = (await readCombo(before)) || {};   // PERCEIVE the offered combo
      if (!team) { console.log('  ! no combo parsed; buttons:', JSON.stringify(await buttons())); break; }
      await sleep(3800);                            // wait out the spin animation

      // skip phase: ask the brain; it may want up to one Team-skip and one
      // Era-skip this round. Loop at most twice (each skip can be used once).
      for (let s = 0; s < 2; s++) {
        const d = decide(roster, team, era, skips, MARGIN);   // DECIDE
        if (d.action === 'skipTeam' && skips.team) {
          const b = logs.length; await clickText(['Team']); skips.team = false;   // ACT: skip team
          ({ team, era } = (await readCombo(b)) || { team, era }); await sleep(3800);
          console.log(`  skip team -> ${team} ${era}`);
        } else if (d.action === 'skipDecade' && skips.decade) {
          const b = logs.length; await clickText(['Era']); skips.decade = false;  // ACT: skip era
          ({ team, era } = (await readCombo(b)) || { team, era }); await sleep(3800);
          console.log(`  skip era  -> ${team} ${era}`);
        } else break;                              // brain wants to place: stop skipping
      }

      // place phase: pick the best player the brain would choose, but only from
      // players actually shown on the page (guards against any DB/site mismatch).
      const body = await bodyText();
      const offered = pool(team, era).filter(p => body.includes(p.player));
      const place = bestPlacement(roster, offered);   // DECIDE the placement
      if (!place) { console.log(`  ! no eligible player for ${team} ${era} (open: ${POS.filter((s,i)=>!roster[i])})`); break; }
      await clickPlayer(place.player.player); await sleep(800);   // ACT: select player
      await clickSlot(place.slot); await sleep(1100);             // ACT: place in slot
      roster[POS.indexOf(place.slot)] = place.player;
      console.log(`  R${round + 1} ${team} ${era}: ${place.slot} <- ${place.player.player}  (proj ovr ${place.ovr})`);
    }

    // --- read the result for this game ---
    await sleep(2500);
    // Source of truth = our verified scoring port (the page "pts" matches teamOvr
    // exactly), so we decide win/loss from our own computation rather than scraping.
    const ovr = brain.teamOvr(roster);
    const wins = brain.winsFor(ovr);
    won = wins === 82;
    // Cross-check against the on-page PROJECTED RECORD (uses an en-dash). We must
    // NOT loosely match "82-0" — that hyphenated string is the site's branding.
    const pageRec = await pg.evaluate(() => {
      const m = (document.body.innerText || '').match(/PROJECTED RECORD\s*(\d{1,2})\s*[‒-―\-]\s*(\d{1,2})/);
      return m ? `${m[1]}-${m[2]}` : null;
    });
    console.log(`  -> teamOvr=${ovr}  computed ${wins}-${82 - wins}  page=${pageRec || '?'}`);
    if (pageRec && pageRec !== `${wins}-${82 - wins}`) console.log(`  ! WARN computed record disagrees with page (${pageRec})`);

    if (won) {
      await pg.screenshot({ path: 'result_honest_win.png', fullPage: true });   // capture proof
      console.log('\n  *** 82-0 ACHIEVED (honestly) *** -> result_honest_win.png');
    } else {
      // Not a win: start a fresh game. Label varies, so try the likely ones.
      await clickText(['Build Another', 'Play Again', 'New Game', 'Try Again', 'Play Classic']);
      await sleep(2500);
    }
  }

  if (!won) console.log(`\nNo 82-0 within ${maxGames} games (expected ~1 in 109). Brain/driver validated.`);
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
