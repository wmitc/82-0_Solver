// 82-0 HONEST-PLAY AGENT  (offline simulator + shared strategy core)
//
// Plays 82-0.com by the real rules: it never touches Math.random. Each round it
// reads the (team, era) the slot machine offers, picks the best available player
// for an open slot, spends its one team-skip and one decade-skip when a spin is
// weak, and after 5 picks checks the record. If it isn't 82-0 it replays.
//
// This file is the brain + an offline Monte-Carlo simulator that estimates the
// per-game win probability so we know whether "replay until 82-0" is practical.
// The live Playwright driver (added next) imports the same strategy.
//
// Usage:
//   node honest_play.js sim [games]       # Monte-Carlo win-rate estimate
//   node honest_play.js sim 200000        # more games
const fs = require('fs');

// ---------------------------------------------------------------- data + model
const P = JSON.parse(fs.readFileSync(__dirname + '/players_flat.json', 'utf8'));
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
const WIN_OVR = 109.5;                 // teamOvr at/above which wins === 82

// exact port of the game's calculateTeamResult
const W = { ppg: .46, rpg: .25, apg: .18, spg: .07, bpg: .04 };
const NRM = { ppg: 133.4, rpg: 39.7, apg: 29.3, spg: 6.1, bpg: 3.2 };
function adj(vals) {                    // mean*5 over players that have the stat
  const v = vals.filter(x => x != null && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) * (5 / v.length) : 0;
}
function teamOvr(roster) {
  const r = roster.filter(Boolean);
  const sum = k => r.reduce((a, p) => a + (p[k] || 0), 0);
  const ovr = 100 * (
    sum('ppg') / NRM.ppg * W.ppg + sum('rpg') / NRM.rpg * W.rpg +
    sum('apg') / NRM.apg * W.apg +
    adj(r.map(p => p.spg)) / NRM.spg * W.spg +
    adj(r.map(p => p.bpg)) / NRM.bpg * W.bpg);
  return Math.round(ovr * 10) / 10;
}
function winsFor(ovr) { return Math.round(82 * Math.pow(Math.min(ovr / 110, 1), 1.15)); }

// ---------------------------------------------------------------- combo tables
const byCombo = {};                    // "TEAM|era" -> [players]
const teamsByEra = {};                 // era -> Set(team)
const erasByTeam = {};                 // team -> Set(era)
for (const p of P) {
  const k = p.team + '|' + p.era;
  (byCombo[k] = byCombo[k] || []).push(p);
  (teamsByEra[p.era] = teamsByEra[p.era] || new Set()).add(p.team);
  (erasByTeam[p.team] = erasByTeam[p.team] || new Set()).add(p.era);
}
const COMBOS = Object.keys(byCombo);
function pool(team, era) { return byCombo[team + '|' + era] || []; }
function eligible(p, slot) { return (p.positions || [p.pos]).includes(slot); }

// ---------------------------------------------------------------- strategy core
// roster: array of 5 (indexed by POS), null = open.
// Returns {player, slot, ovr} for the best single placement from `players`, or null.
function bestPlacement(roster, players) {
  let best = null;
  const openSlots = POS.filter((s, i) => !roster[i]);
  for (const p of players) {
    // slots this player can take among the open ones; prefer scarce slots (C first)
    const slots = openSlots.filter(s => eligible(p, s));
    if (!slots.length) continue;
    const slot = slots.sort((a, b) => SLOT_PRIO[a] - SLOT_PRIO[b])[0];
    const trial = roster.slice();
    trial[POS.indexOf(slot)] = p;
    const ovr = teamOvr(trial);
    if (!best || ovr > best.ovr) best = { player: p, slot, ovr };
  }
  return best;
}
const SLOT_PRIO = { C: 0, PG: 1, PF: 2, SF: 3, SG: 4 };  // fill scarce positions first

// Decide the action for a freshly spun (team, era), given remaining skips.
// Returns {action:'place', placement} | {action:'skipTeam'} | {action:'skipDecade'}.
// Skip is chosen when the expected best placement after a one-axis re-roll beats
// keeping the current offer by `margin` (and that axis hasn't been skipped yet).
function decide(roster, team, era, skips, margin) {
  const here = bestPlacement(roster, pool(team, era));
  const hereOvr = here ? here.ovr : -Infinity;

  const axisEV = (cands, mk) => {           // mean best-ovr over a re-roll axis
    let s = 0, n = 0;
    for (const c of cands) {
      const bp = bestPlacement(roster, pool(...mk(c)));
      if (bp) { s += bp.ovr; n++; }
    }
    return n ? s / n : -Infinity;
  };

  let teamEV = -Infinity, decEV = -Infinity;
  if (skips.team) {
    const cands = [...teamsByEra[era]].filter(t => t !== team);
    teamEV = axisEV(cands, t => [t, era]);
  }
  if (skips.decade) {
    const cands = [...erasByTeam[team]].filter(e => e !== era);
    decEV = axisEV(cands, e => [team, e]);
  }
  if (teamEV >= decEV && teamEV > hereOvr + margin) return { action: 'skipTeam' };
  if (decEV > hereOvr + margin)                     return { action: 'skipDecade' };
  return { action: 'place', placement: here };
}

// ---------------------------------------------------------------- simulator
const rint = n => Math.floor(Math.random() * n);
function spinCombo() { return COMBOS[rint(COMBOS.length)].split('|'); }   // [team,era]
function reroll(axis, team, era) {                                        // skip re-roll
  if (axis === 'team') { const c = [...teamsByEra[era]].filter(t => t !== team); return [c[rint(c.length)], era]; }
  const c = [...erasByTeam[team]].filter(e => e !== era); return [team, c[rint(c.length)]];
}

function playGame(margin) {
  const roster = [null, null, null, null, null];
  const skips = { team: true, decade: true };
  for (let round = 0; round < 5; round++) {
    let [team, era] = spinCombo();
    let d = decide(roster, team, era, skips, margin);
    if (d.action === 'skipTeam')   { skips.team = false;   [team, era] = reroll('team', team, era);   d = decide(roster, team, era, { team: false, decade: skips.decade }, margin); }
    else if (d.action === 'skipDecade') { skips.decade = false; [team, era] = reroll('decade', team, era); d = decide(roster, team, era, { team: skips.team, decade: false }, margin); }
    const place = d.placement || bestPlacement(roster, pool(team, era));
    if (!place) return null;            // stuck: no eligible player for any open slot
    roster[POS.indexOf(place.slot)] = place.player;
  }
  return teamOvr(roster);
}

function sim(games, margin) {
  let wins = 0, sumOvr = 0, best = 0, stuck = 0;
  const buckets = {};
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
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'sim') {
    const games = parseInt(process.argv[3] || '50000', 10);
    console.log(`Valid combos: ${COMBOS.length} | players: ${P.length} | win threshold teamOvr >= ${WIN_OVR}\n`);
    for (const margin of [0, 0.5, 1.0, 2.0]) {
      const r = sim(games, margin);
      const exp = r.p > 0 ? (1 / r.p).toFixed(0) : '∞';
      console.log(`margin=${margin.toFixed(1)}  win=${r.wins}/${r.played}  P(win)=${(r.p * 100).toFixed(3)}%  ~1 in ${exp} games  meanOvr=${r.meanOvr.toFixed(1)}  bestOvr=${r.best}  stuck=${r.stuck}`);
    }
  } else {
    console.log('usage: node honest_play.js sim [games]');
  }
}

module.exports = { teamOvr, winsFor, bestPlacement, decide, pool, teamsByEra, erasByTeam, POS, WIN_OVR };
