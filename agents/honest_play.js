// 82-0 HONEST-PLAY AGENT  (strategy "brain" + offline simulator)
//
// This file is two things in one:
//   1. The agent's BRAIN (the policy): given a roster-so-far and a spun
//      (team, era), decide which player to place or whether to skip. The live
//      driver (honest_live.js) imports these functions and uses them to play
//      the real website.
//   2. An offline MONTE-CARLO SIMULATOR: a model of the game that runs that
//      same policy against millions of randomly-generated spins, purely in
//      memory, to estimate how often honest play reaches 82-0. No browser, no
//      network — just math, which is why `sim` finishes in seconds.
//
// The agent plays by the real rules: it never touches Math.random. Each round
// it reads the (team, era) the slot machine offers, picks the best available
// player for an open slot, spends its one team-skip and one decade-skip when a
// spin is weak, and after 5 picks checks the record. If it isn't 82-0 it replays.
//
// Usage:
//   node agents/honest_play.js sim [games]     # Monte-Carlo win-rate estimate
//   node agents/honest_play.js sim 200000      # more games = tighter estimate
const fs = require('fs');

// ---------------------------------------------------------------- data + model
// The player database: ~10,932 players, each {team, player, pos, positions[],
// era, ppg, rpg, apg, spg, bpg}. spg/bpg are null for pre-~1973 players (steals
// and blocks weren't tracked yet) — that null-ness is central to the scoring.
const P = JSON.parse(fs.readFileSync(__dirname + '/../data/players_flat.json', 'utf8'));
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];   // the five court slots
const WIN_OVR = 109.5;                 // teamOvr at/above which wins === 82

// --- exact port of the game's scoring (calculateTeamResult) ---
// teamOvr is a weighted, normalized sum of the five players' per-game stats.
// W = category weights; NRM = the normalizing divisors the game uses.
const W = { ppg: .46, rpg: .25, apg: .18, spg: .07, bpg: .04 };
const NRM = { ppg: 133.4, rpg: 39.7, apg: 29.3, spg: 6.1, bpg: 3.2 };
// adj(): the steals/blocks aggregator. KEY QUIRK — it does NOT impute 0 for the
// players missing the stat. It averages over only the players that HAVE it, then
// multiplies by 5 (i.e. pretends all five posted that average). So one modern
// defender's steals/blocks get amplified team-wide, and older legends with null
// spg/bpg are not penalized.
function adj(vals) {                    // mean*5 over players that have the stat
  const v = vals.filter(x => x != null && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) * (5 / v.length) : 0;
}
// teamOvr only depends on the SET of five players, not which slot each fills.
function teamOvr(roster) {
  const r = roster.filter(Boolean);     // ignore not-yet-filled slots
  const sum = k => r.reduce((a, p) => a + (p[k] || 0), 0);   // plain sum of a stat
  const ovr = 100 * (
    sum('ppg') / NRM.ppg * W.ppg + sum('rpg') / NRM.rpg * W.rpg +
    sum('apg') / NRM.apg * W.apg +
    adj(r.map(p => p.spg)) / NRM.spg * W.spg +   // steals via the mean*5 rule
    adj(r.map(p => p.bpg)) / NRM.bpg * W.bpg);   // blocks via the mean*5 rule
  return Math.round(ovr * 10) / 10;     // game rounds to 1 decimal
}
// The win curve: convex, and capped at teamOvr/110 = 1, so overshooting 110
// earns nothing. winsFor(109.5) === 82; anything lower rounds to 81 or fewer.
function winsFor(ovr) { return Math.round(82 * Math.pow(Math.min(ovr / 110, 1), 1.15)); }

// ---------------------------------------------------------------- combo tables
// Precompute lookups once at load so the brain/sim can run hot. A "combo" is a
// valid (team, era) pairing the slot machine can land on.
const byCombo = {};                    // "TEAM|era" -> [players in that team/era]
const teamsByEra = {};                 // era -> Set(team)  : teams valid for an era
const erasByTeam = {};                 // team -> Set(era)  : eras valid for a team
for (const p of P) {
  const k = p.team + '|' + p.era;
  (byCombo[k] = byCombo[k] || []).push(p);
  (teamsByEra[p.era] = teamsByEra[p.era] || new Set()).add(p.team);
  (erasByTeam[p.team] = erasByTeam[p.team] || new Set()).add(p.era);
}
const COMBOS = Object.keys(byCombo);                          // every valid combo
const pool = (team, era) => byCombo[team + '|' + era] || [];  // players for a combo
// A player may only be placed in a slot listed in its `positions` (or `pos`).
function eligible(p, slot) { return (p.positions || [p.pos]).includes(slot); }

// ---------------------------------------------------------------- strategy core
// bestPlacement: given the roster-so-far and a set of offered `players`, find the
// single best player+slot to add right now (the one that maximizes teamOvr).
// roster: array of 5 (indexed by POS), null = open slot. Returns {player, slot,
// ovr} or null if no offered player fits any open slot.
function bestPlacement(roster, players) {
  let best = null;
  const openSlots = POS.filter((s, i) => !roster[i]);   // slots still to fill
  for (const p of players) {
    // which open slots this player can legally take
    const slots = openSlots.filter(s => eligible(p, s));
    if (!slots.length) continue;
    // If eligible for several, take the scarcest (C first) to keep future slots
    // fillable — teamOvr is slot-independent, so this only protects feasibility.
    const slot = slots.sort((a, b) => SLOT_PRIO[a] - SLOT_PRIO[b])[0];
    const trial = roster.slice();
    trial[POS.indexOf(slot)] = p;
    const ovr = teamOvr(trial);                          // score the hypothetical
    if (!best || ovr > best.ovr) best = { player: p, slot, ovr };
  }
  return best;
}
const SLOT_PRIO = { C: 0, PG: 1, PF: 2, SF: 3, SG: 4 };  // fill scarce positions first

// decide: the round-by-round policy. For a freshly spun (team, era) and the
// skips still in hand, choose to place the best current player or to spend a
// skip. Returns {action:'place', placement} | {action:'skipTeam'} | {action:'skipDecade'}.
//
// `margin` is the skip threshold (in teamOvr points): we only skip if the
// EXPECTED best placement after a random one-axis re-roll beats placing now by
// more than `margin`. Higher margin = more reluctant to spend skips. The
// simulator found margin = 1.0 best.
function decide(roster, team, era, skips, margin) {
  const here = bestPlacement(roster, pool(team, era));   // value of placing now
  const hereOvr = here ? here.ovr : -Infinity;

  // axisEV: average "best placement teamOvr" over a set of re-roll candidates.
  // Re-rolls are random, so we use the mean (expected value) over what we might
  // land on. `mk` maps a candidate to a (team, era) for the pool lookup.
  const axisEV = (cands, mk) => {
    let s = 0, n = 0;
    for (const c of cands) {
      const bp = bestPlacement(roster, pool(...mk(c)));
      if (bp) { s += bp.ovr; n++; }
    }
    return n ? s / n : -Infinity;
  };

  let teamEV = -Infinity, decEV = -Infinity;
  if (skips.team) {                       // skip-team keeps the era, re-rolls the team
    const cands = [...teamsByEra[era]].filter(t => t !== team);
    teamEV = axisEV(cands, t => [t, era]);
  }
  if (skips.decade) {                     // skip-decade keeps the team, re-rolls the era
    const cands = [...erasByTeam[team]].filter(e => e !== era);
    decEV = axisEV(cands, e => [team, e]);
  }
  // Skip only if a re-roll's expected payoff clears `here + margin`; prefer the
  // team-skip on ties. Otherwise just place the best current player.
  if (teamEV >= decEV && teamEV > hereOvr + margin) return { action: 'skipTeam' };
  if (decEV > hereOvr + margin)                     return { action: 'skipDecade' };
  return { action: 'place', placement: here };
}

// ---------------------------------------------------------------- simulator
// A pure in-memory MODEL of the game (no browser/network). spinCombo() mimics
// the slot machine; reroll() mimics what a skip does. Because it's just array
// indexing and arithmetic, it runs ~millions of games faster than real play.
const rint = n => Math.floor(Math.random() * n);
function spinCombo() { return COMBOS[rint(COMBOS.length)].split('|'); }   // random [team,era]
function reroll(axis, team, era) {                                        // a skip's random re-roll
  if (axis === 'team') { const c = [...teamsByEra[era]].filter(t => t !== team); return [c[rint(c.length)], era]; }
  const c = [...erasByTeam[team]].filter(e => e !== era); return [team, c[rint(c.length)]];
}

// Play one simulated 5-round game with the given skip margin; return final teamOvr.
function playGame(margin) {
  const roster = [null, null, null, null, null];
  const skips = { team: true, decade: true };   // one of each, for the whole game
  for (let round = 0; round < 5; round++) {      // the game is always 5 rounds
    let [team, era] = spinCombo();               // slot machine offers a combo
    let d = decide(roster, team, era, skips, margin);
    // If the policy wants a skip, consume it, re-roll that axis, and decide again
    // (so it can still use the other skip, or place, on the new offer).
    if (d.action === 'skipTeam')   { skips.team = false;   [team, era] = reroll('team', team, era);   d = decide(roster, team, era, { team: false, decade: skips.decade }, margin); }
    else if (d.action === 'skipDecade') { skips.decade = false; [team, era] = reroll('decade', team, era); d = decide(roster, team, era, { team: skips.team, decade: false }, margin); }
    const place = d.placement || bestPlacement(roster, pool(team, era));
    if (!place) return null;            // stuck: no eligible player for any open slot
    roster[POS.indexOf(place.slot)] = place.player;
  }
  return teamOvr(roster);
}

// Run `games` simulated games at a given margin and tally the win rate + stats.
function sim(games, margin) {
  let wins = 0, sumOvr = 0, best = 0, stuck = 0;
  const buckets = {};                   // teamOvr histogram (2-pt buckets)
  for (let i = 0; i < games; i++) {
    const ovr = playGame(margin);
    if (ovr == null) { stuck++; continue; }
    sumOvr += ovr; if (ovr > best) best = ovr;
    if (winsFor(ovr) === 82) wins++;
    const b = Math.floor(ovr / 2) * 2; buckets[b] = (buckets[b] || 0) + 1;
  }
  const played = games - stuck;
  return { games, played, stuck, wins, p: wins / played, meanOvr: sumOvr / played, best, buckets };
}

// ---------------------------------------------------------------- cli
// Only run the CLI when executed directly (node honest_play.js ...). When the
// live driver `require()`s this file, require.main !== module, so nothing runs
// here and it just gets the exported functions below.
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'sim') {
    const games = parseInt(process.argv[3] || '50000', 10);
    console.log(`Valid combos: ${COMBOS.length} | players: ${P.length} | win threshold teamOvr >= ${WIN_OVR}\n`);
    // Sweep a few skip margins so we can see which is most effective.
    for (const margin of [0, 0.5, 1.0, 2.0]) {
      const r = sim(games, margin);
      const exp = r.p > 0 ? (1 / r.p).toFixed(0) : '∞';
      console.log(`margin=${margin.toFixed(1)}  win=${r.wins}/${r.played}  P(win)=${(r.p * 100).toFixed(3)}%  ~1 in ${exp} games  meanOvr=${r.meanOvr.toFixed(1)}  bestOvr=${r.best}  stuck=${r.stuck}`);
    }
  } else {
    console.log('usage: node agents/honest_play.js sim [games]');
  }
}

// Exported so honest_live.js can reuse the exact same brain against the live site.
module.exports = { teamOvr, winsFor, bestPlacement, decide, pool, teamsByEra, erasByTeam, POS, WIN_OVR };
