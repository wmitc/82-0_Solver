import json, itertools, os
_DATA = os.path.join(os.path.dirname(__file__), "..", "data", "players_flat.json")
players=json.load(open(_DATA))

# ---- exact port of calculateTeamResult(players, testMode=False) ----
W_PPG,W_RPG,W_APG,W_SPG,W_BPG = .46,.25,.18,.07,.04
N_PPG,N_RPG,N_APG,N_SPG,N_BPG = 133.4,39.7,29.3,6.1,3.2

def adj(vals):
    v=[x for x in vals if x is not None and x>0]
    return sum(v)*(5/len(v) if v else 1)

def team_result(roster):
    spg=adj([p.get("spg") for p in roster])
    bpg=adj([p.get("bpg") for p in roster])
    ppg=sum((p.get("ppg") or 0) for p in roster)
    rpg=sum((p.get("rpg") or 0) for p in roster)
    apg=sum((p.get("apg") or 0) for p in roster)
    ovr=round(100*(ppg/N_PPG*W_PPG + rpg/N_RPG*W_RPG + apg/N_APG*W_APG
                   + spg/N_SPG*W_SPG + bpg/N_BPG*W_BPG)*10)/10
    wins=round(82*min(ovr/110,1)**1.15)
    return ovr,wins,82-wins

POS=["PG","SG","SF","PF","C"]
def canplay(p,slot):
    pl=p.get("positions") or [p.get("pos")]
    return slot in pl

# linear value of a player IF all 5 have spg/bpg (upper-ish bound proxy for greedy)
def linval(p):
    return (0.3448*(p.get("ppg") or 0)+0.6297*(p.get("rpg") or 0)+0.6143*(p.get("apg") or 0)
            +1.1475*(p.get("spg") or 0)+1.25*(p.get("bpg") or 0))

# Build candidate pool per position: top ~30 by linval that can play that slot
cand={s:sorted([p for p in players if canplay(p,s)],key=linval,reverse=True)[:25] for s in POS}
for s in POS: print(s, "pool", len(cand[s]), "best:", cand[s][0]["player"], cand[s][0]["era"])

# exhaustive over reduced pools is 25^5=9.7M -> too big. Use beam / smart search:
# Strategy: the spg/bpg term rewards a HIGH MEAN among players-with-data. Since older stars have null spg/bpg,
# mixing them is fine (nulls excluded from mean). So just maximize using real team_result over a beam.
best=None
import random
# Greedy + local search restarts
def evaluate(combo): return team_result(combo)

# Start: pick best linval per position
cur=[cand[s][0] for s in POS]
def total(c): return team_result(c)[0]
improved=True
while improved:
    improved=False
    for i,s in enumerate(POS):
        for repl in cand[s]:
            trial=cur[:]; trial[i]=repl
            if total(trial)>total(cur):
                cur=trial; improved=True
ovr,w,l=team_result(cur)
print("\n=== Local-search optimum ===")
for s,p in zip(POS,cur):
    print(f"{s}: {p['player']:22s} {p['team']} {p['era']:6s} ppg {p['ppg']} rpg {p['rpg']} apg {p['apg']} spg {p['spg']} bpg {p['bpg']}")
print(f"teamOvr={ovr}  record {w}-{l}")
