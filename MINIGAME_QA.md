# Mini-games — inventory and QA

Fifteen playable things, and what each of them does when you play it three
times.

The rows below are not read off the source. They come from
`node scripts/world-minigame-qa.mjs <url>`, which for every registered game
stands the car at its actual venue, starts it, checks it entered a playing
state, exits it, checks the HUD went with it, and then does the whole thing
again — twice, with a drive away and back before the third go. That third
attempt is the one that matters: a mini-game that works once and works
again immediately is not the same as one that survives being left.

    node scripts/world-minigame-qa.mjs http://localhost:3000
    node scripts/world-minigame-qa.mjs http://localhost:3000 --only=bowling,circuit

Last run: **15 of 15 passing, no console errors, no stale HUD.**

---

## The standard

Every game has to have all of these, and the harness checks the ones a
machine can check:

| | checked by |
|---|---|
| clear entrance | by hand — a landmark or a play spot with a popup |
| clear name and instructions | by hand |
| start | harness |
| playing state | harness |
| success | by hand |
| failure / retry where relevant | by hand |
| exit | harness |
| HUD cleared on exit | harness |
| replay, twice, with a departure between | harness |
| audio | by hand |
| no stale input, collider or state | harness (player state after exit) |

---

## The inventory

| game | venue | start | instructions | success | failure | reset | replay | exit | audio | achievement |
|---|---|---|---|---|---|---|---|---|---|---|
| **circuit** — NEWPORT CIRCUIT | (−55, 79) | landmark | countdown card, 2 LAPS | 2 laps, ordered gates | strayed / abandoned | full | ✔ | ✔ | ✔ | `circuit`, `speedDemon`, `perfectRun` |
| **bowling** — NEWPORT LANES | (76, 44) | play spot | lane markings + popup | pins down / strike | — | full rack reset | ✔ | ✔ | ✔ | `bowling` |
| **labyrinth** | (98, −26) | gate + sign | 3-2-1 card, "find the centre in 90s" | reach the centre | time limit | full | ✔ | ✔ | ✔ | `pathFound` |
| **chess** — CHESS ASSISTANT | (−6, −80) | landmark | board prompt | mate in one | wrong move | full | ✔ | ✔ | ✔ | `checkmate` |
| **pipeline** — VIDEO PIPELINE | (62, 37) | station | stage labels | all stages | — | full | ✔ | ✔ | ✔ | `contentEngine` |
| **retrieval** — METAVIEW | (34, −107) | terminal | cluster prompts | all clusters | — | full | ✔ | ✔ | ✔ | `retrieval` |
| **orderRush** — EXCHANGE | (66, −72) | order book | countdown + order card | fill the book | order expired | full | ✔ | ✔ | ✔ | `orderRush` |
| **gymCircuit** | (59, 77) | gate | station labels | all stations | — | full | ✔ | ✔ | ✔ | `gymCircuit` |
| **threeBody** | (38, −46) | landmark | orbit readout | stable orbit | collapse | full | ✔ | ✔ | ✔ | `chaosTheory` |
| **packets** — PACKET RUN | (82, −122) | node B | gate course | all gates | dropped | full | ✔ | ✔ | ✔ | `tunnel` |
| **debugDash** | (8, 46) | play spot | title + rule card | eight failures down | — | full | ✔ | ✔ | ✔ | `debugDash` |
| **riverRun** | (−32, −14) | play spot | title + rule card | six beacons | — | full | ✔ | ✔ | ✔ | `riverRun` |
| **chipRelay** | (34, 40) | play spot | title + rule card | three chips returned | — | full | ✔ | ✔ | ✔ | `chipRelay` |
| **domino** — TNT DOMINO | (92, 8) | TNT QUARRY | title + rule card | full chain | — | crates restored | ✔ | ✔ | ✔ | `domino` |
| **deployment** — ALTAR | (58, −48) | play spot | title + rule card | package settles | — | full | ✔ | ✔ | ✔ | `deployment` |

Not mini-games, but interactive and on the same replay contract: the TIME
MACHINE (62, 88), the OUT OF OFFICE cabin (−72, 10) in the circuit infield,
the GRAVITY WELL (58, −118), the PARTICLE FIELD (80, −54), PROCEDURAL
TERRAIN (120, 50), and the physical name at the hub.

---

## What was wrong, and what fixed it

These are the defects the audit found and this pass closed. Where a fix
came from the shared base class rather than the individual game, it is
noted — most of them did, which is the point of having one.

**The clocks ran at double speed.** `Minigames` fed each game
`ticker.delta`, and the world's ticker runs at `scale = 2` on purpose. So
every countdown in this folder expired in half its stated time, and
OrderRush's card said "12.0S" while giving you six. Fixed in the manager:
mini-game time is now real seconds, dilated only by bullet time.

**A finished card could outlive its game.** `finish()` arms a dismissal
timer and two games called `prepareAttempt()` immediately afterwards, which
cancels it — so the result card either never appeared or never left, and in
one case followed the player around the island for the rest of the session.
The base class now detects a stale result and clears it.

**OrderRush could not be exited.** `cancel()` early-returned in the
`failed` state, so pressing ESCAPE on a failed order left "ORDER EXPIRED"
welded to the HUD permanently.

**The labyrinth gate could not start the labyrinth**, and was embedded in a
maze wall. The maze now registers its own entrance at the mouth, with a
sign, a 3-2-1 countdown and a stated time limit — it had no instruction
screen, no failure condition and no exit affordance at all.

**Opening an overlay froze the active game instead of cancelling it**,
which locked the player inside chess or suspended the OrderRush countdown
indefinitely.

**The HUD re-rendered sixty times a second.** Every game published a fresh
object each frame; they are now compared before publishing.

**Three games were built on top of other content**: two RETRIEVAL clusters
on the PACKET RUN causeway and its node A, three of five VIDEO PIPELINE
stations inside other districts with its render screen on the FOCUS
respawn, and the three live lab installations outside the world entirely.

**PACKET RUN cleared three of its own gates while parked** — the gate
spacing equalled the gate radius — and teleported the player for driving on
flat ground beside its causeway.

**Completing VIDEO PIPELINE and then pressing Escape switched the reward
screen back off.**

**The Labyrinth took the whole world down on boot.** It called
`game.playground.label(...)` from its constructor, and Playground is built
two-thirds of the way through `Game.init`, after the mini-games — so
`playground` was `undefined` and the world never started. The sign helper
is now a free function in `materials.ts`, which is what it always was.

---

## Bowling, specifically

The brief singles it out, so: it had a blocker where stale hard-coded venue
coordinates made the game auto-complete without the ball ever moving. Its
pins were not a standard ten-pin triangle and were badly under-scaled
against their own lane and ball. There were no gutters, no pin deck, no pit
and no backstop, and the rails sat outside the playing surface. The
pin-down test was tilt-only, so a pin knocked clean off the deck while
still upright counted as standing. And there was no score model: one frame,
no running total, and a "best time", which is not a thing bowling has.

It now has a proper lane with gutters, a deck and a backstop; lathe-built
pins with a neck stripe rather than cylinders; a correct ten-pin triangle;
a pin-state display; strike detection; and per-frame scoring with running
totals.

---

## Known limits

- **The harness checks that a game can be entered, exited and re-entered.
  It does not check that a game can be WON** — winning chess requires
  playing chess, and winning the circuit requires driving two laps, both of
  which have their own harnesses (`world-race-drive.mjs`) or were played by
  hand. Success conditions in the table above are from reading and playing,
  not from an assertion.
- **Audio is marked ✔ from the code path, not from listening.** Every game
  calls `game.audio` on start, on progress and on success; none of that is
  verified automatically.
- The `cabin`, `gravityWell`, `particleField` and `procedural` spots are
  scenery with a prompt rather than games with a state machine, so they are
  outside the harness.
