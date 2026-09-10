/* ============================================================
   ACHIEVEMENTS — /world

   Declarative. The engine only knows how to add progress to an
   id; what that id means, what it is worth and when it unlocks
   lives here. Progress is persisted per-browser (see
   `src/world/systems/Save.ts`) — there is no backend and no
   account.

   EVERY ID BELOW MUST BE SET BY SOMETHING THAT IS STILL ON THE
   ISLAND, and every target must be reachable from what the world
   actually builds. COMPLETIONIST requires all of them, so one
   award whose trigger left with its district — or one target
   counted from an inventory that shrank — makes the last
   achievement permanently unreachable and turns the panel into a
   list nobody can finish. When a place goes, its award goes with
   it in the same commit; when a target is a count of things,
   the comment says where the count comes from.
   ============================================================ */

export type AchievementGroup =
  | 'driving'
  | 'exploration'
  | 'projects'
  | 'minigames'
  | 'playground'
  | 'secrets'

export interface Achievement {
  id: string
  label: string
  /** How to get it. Shown for locked achievements too — nothing is a riddle. */
  hint: string
  group: AchievementGroup
  /** Progress needed to unlock. 1 = a one-shot flag. */
  target: number
  /** Suffix on the progress readout, e.g. "km". */
  unit?: string
  /** Hidden in the list until unlocked. Used sparingly. */
  hidden?: boolean
}

export const achievements: Achievement[] = [
  /* ---- driving ------------------------------------------- */
  { id: 'firstDrive', label: 'FIRST DRIVE', hint: 'Move the car.', group: 'driving', target: 1 },
  { id: 'takeoff', label: 'TAKEOFF', hint: 'Get all four wheels off the ground.', group: 'driving', target: 1 },
  { id: 'boosted', label: 'BOOSTED', hint: 'Hold Shift and mean it.', group: 'driving', target: 1 },
  { id: 'honk', label: 'ACKNOWLEDGED', hint: 'Use the horn ten times.', group: 'driving', target: 10 },
  { id: 'hydraulics', label: 'LOWRIDER', hint: 'Bounce the suspension on one corner at a time.', group: 'driving', target: 8 },
  { id: 'backflip', label: 'BACKFLIP', hint: 'Land a full backwards rotation.', group: 'driving', target: 1 },
  { id: 'frontflip', label: 'FRONTFLIP', hint: 'Land a full forwards rotation.', group: 'driving', target: 1 },
  { id: 'upsideDown', label: 'ON YOUR ROOF', hint: 'End up completely upside down.', group: 'driving', target: 1 },
  { id: 'goHigh', label: 'ALTITUDE', hint: 'Reach 30 metres above the ground.', group: 'driving', target: 30, unit: 'm' },
  { id: 'distance', label: 'LONG HAUL', hint: 'Drive five kilometres in total.', group: 'driving', target: 5, unit: 'km' },
  // Counted by unique cone, and `World.ts` tags forty-four on the
  // landing alone before bowling, projects and achievements add
  // thirty-six more — so twenty is a morning's demolition, not a
  // requirement to find every cone on the island.
  { id: 'cones', label: 'CLEAN SWEEP', hint: 'Knock over twenty traffic cones.', group: 'driving', target: 20 },
  // `Secrets.ts` arms a zone PAST the ramp's lip and only awards this
  // if the car was more than five metres up while crossing it, so
  // trundling off the side of the ramp is not a jump.
  { id: 'airborne', label: 'OFF THE END', hint: 'Launch off the big east ramp and land in the shallows.', group: 'driving', target: 1 },

  /* ---- exploration --------------------------------------- */
  // Eight, because eight districts carry `signposted` in `world.ts` and
  // only a signposted one calls `set('explorer', …)`. BLACK HOLE is
  // secret and TNT is unsignposted, so neither can ever land here.
  // The old island's thirteen left this five districts short of
  // anything that exists, and took COMPLETIONIST down with it.
  { id: 'explorer', label: 'EXPLORER', hint: 'Enter every signposted district.', group: 'exploration', target: 8 },
  { id: 'sea', label: 'OUT OF BOUNDS', hint: 'Drive past the edge of the world.', group: 'exploration', target: 1 },
  // Thirteen notes are placed; six is a reward for wandering rather
  // than a sweep of the whole map.
  { id: 'notes', label: 'MARGINALIA', hint: 'Find six dev notes.', group: 'exploration', target: 6 },
  // The island has no night, so this is the weather instead: it rains
  // often enough to be found and rarely enough to be a find.
  { id: 'nightDrive', label: 'STORM SHIFT', hint: 'Drive through the rain.', group: 'exploration', target: 1 },

  /* ---- projects ------------------------------------------ */
  // Counted across the whole island, not just PROJECTS: WELCOME,
  // ABOUT, SOCIAL, the black hole and the two hub terminals are six
  // before a single plinth, and every plinth adds one — so ten is
  // comfortably inside what is built.
  { id: 'projects', label: 'READING UP', hint: 'Open ten project panels.', group: 'projects', target: 10 },
  // Counted from the plinth ring and the terminal at its centre.
  // Pinned to eight rather than to `FEATURED_SLUGS.length`, which is
  // whatever `projects/*` currently tiers as featured or hero: tying
  // the bar to that number means promoting a project silently raises
  // it, and a bar above the ring takes COMPLETIONIST with it.
  { id: 'archivist', label: 'ARCHIVIST', hint: 'Read eight of the project plinths around the terminal.', group: 'projects', target: 8 },

  /* ---- mini-games ---------------------------------------- */
  { id: 'circuit', label: 'CHEQUERED FLAG', hint: 'Finish a lap of the circuit.', group: 'minigames', target: 1 },
  // The bar is `CIRCUIT.laps * CIRCUIT.targetLapSeconds` — one lap of
  // the 954 m track at 105 s. A hint that quotes a different number
  // from the one the race checks makes the award look broken, so this
  // one is read off the circuit and re-read whenever it changes.
  { id: 'speedDemon', label: 'SPEED DEMON', hint: 'Finish a lap of the circuit inside 1:02.', group: 'minigames', target: 1 },
  { id: 'perfectRun', label: 'CLEAN LAP', hint: 'Finish a lap without recovering at a checkpoint.', group: 'minigames', target: 1 },
  { id: 'pathFound', label: 'PATH FOUND', hint: 'Reach the centre of the labyrinth.', group: 'minigames', target: 1 },
  { id: 'strike', label: 'STRIKE!', hint: 'Knock down all ten bowling pins with your first ball.', group: 'minigames', target: 1 },
  { id: 'spare', label: 'SPARE CHANGE', hint: 'Clear the remaining pins on your second bowling throw.', group: 'minigames', target: 1 },
  { id: 'bowling', label: 'LANE LOGIC', hint: 'Finish a frame at the bowling lane.', group: 'minigames', target: 1 },
  { id: 'domino', label: 'CHAIN REACTION', hint: 'Detonate every crate in the TNT domino challenge.', group: 'minigames', target: 1 },
  // Sixteen letters in ALEJANDRO NEWPORT, which is what Playground
  // builds and counts down; the name stand puts them back up again.
  { id: 'nameDrop', label: 'NAME DROP', hint: 'Topple all sixteen letters, then restore them at the name stand.', group: 'minigames', target: 16 },

  /* ---- playground ---------------------------------------
     Fourteen attractions that have nothing to do with the work;
     `src/world/world/Attractions.ts` builds every one of them and
     awards every id below. Nothing here is a riddle and nothing here
     can be failed — each is set the first time you use the toy, so all
     thirteen are reachable and COMPLETIONIST stays winnable. The two
     counts come from `src/content/attractions.ts`: twelve skittles and
     twelve piano keys. */
  { id: 'brassSection', label: 'BRASS SECTION', hint: 'Sound the klaxon on the landing forecourt ten times.', group: 'playground', target: 10 },
  { id: 'siegeEngine', label: 'SIEGE ENGINE', hint: 'Sit in the catapult cradle and loose the arm.', group: 'playground', target: 1 },
  { id: 'partyTrick', label: 'PARTY TRICK', hint: 'Burst the piñata the catapult is aimed at.', group: 'playground', target: 1 },
  { id: 'pianoRoad', label: 'TWELVE TONE', hint: 'Drive over all twelve keys of the piano road.', group: 'playground', target: 12 },
  { id: 'showroom', label: 'SHOWROOM CONDITION', hint: 'Drive through the car wash on the road to the bridge.', group: 'playground', target: 1 },
  { id: 'backOfTheNet', label: 'BACK OF THE NET', hint: 'Push the big ball into the goal three times.', group: 'playground', target: 3 },
  { id: 'turkeyShoot', label: 'TURKEY SHOOT', hint: 'Flatten all twelve skittles outside the bowling alley.', group: 'playground', target: 12 },
  { id: 'fireInTheSky', label: 'FIRE IN THE SKY', hint: 'Light the firework battery on the bay shore.', group: 'playground', target: 1 },
  { id: 'carillon', label: 'CARILLON', hint: 'Ring the harbour bell seven times inside ten seconds.', group: 'playground', target: 1 },
  { id: 'boing', label: 'BOING', hint: 'Bounce three times on the trampolines without stopping.', group: 'playground', target: 1 },
  { id: 'tilt', label: 'TILT', hint: 'Bounce off the bumpers around the trophy ten times.', group: 'playground', target: 10 },
  { id: 'rainmaker', label: 'RAINMAKER', hint: 'Pull the weather lever and drive in the rain you ordered.', group: 'playground', target: 1 },
  { id: 'spinCycle', label: 'SPIN CYCLE', hint: 'Ride the turntable for a full revolution.', group: 'playground', target: 1 },

  /* ---- secrets ------------------------------------------- */
  { id: 'curious', label: 'CURIOUS', hint: 'Find your first secret.', group: 'secrets', target: 1 },
  { id: 'konami', label: 'UP UP DOWN DOWN', hint: 'You know the one.', group: 'secrets', target: 1 },
  { id: 'timeMachine', label: 'FUTURE COMMIT', hint: 'Start the time machine on the road to the labyrinth.', group: 'secrets', target: 1 },
  // Not hidden, and deliberately: the district is secret on the map, so
  // without a line in this list the only route to COMPLETIONIST would
  // be to guess that the hole in the middle of the north loop can be
  // pressed.
  { id: 'blackHole', label: 'EVENT HORIZON', hint: 'Fall into the black hole inside the circuit\'s north loop.', group: 'secrets', target: 1 },
  { id: 'timeTraveller', label: 'TIME TRAVELLER', hint: 'Drive the years in order.', group: 'secrets', target: 1, hidden: true },
  { id: 'console', label: 'DEVTOOLS', hint: 'Open the browser console.', group: 'secrets', target: 1, hidden: true },
  { id: 'completionist', label: 'COMPLETIONIST', hint: 'Unlock everything else.', group: 'secrets', target: 1 },
]

export const achievementById = Object.fromEntries(achievements.map((a) => [a.id, a]))

export const achievementGroups: { id: AchievementGroup; label: string }[] = [
  { id: 'driving', label: 'Driving' },
  { id: 'exploration', label: 'Exploration' },
  { id: 'projects', label: 'Projects' },
  { id: 'minigames', label: 'Mini-games' },
  { id: 'playground', label: 'Playground' },
  { id: 'secrets', label: 'Secrets' },
]

/** Everything except COMPLETIONIST itself — the set it measures. */
export const completionistTargets = achievements
  .filter((a) => a.id !== 'completionist')
  .map((a) => a.id)
