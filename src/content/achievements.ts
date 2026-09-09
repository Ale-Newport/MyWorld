/* ============================================================
   ACHIEVEMENTS — /world

   Declarative. The engine only knows how to add progress to an
   id; what that id means, what it is worth and when it unlocks
   lives here. Progress is persisted per-browser (see
   `src/world/systems/Save.ts`) — there is no backend and no
   account.
   ============================================================ */

export type AchievementGroup =
  | 'driving'
  | 'exploration'
  | 'projects'
  | 'minigames'
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
  { id: 'labPlay', label: 'EXPERIMENTAL', hint: 'Interact with all three live laboratory instruments.', group: 'exploration', target: 3 },
  { id: 'perfectRun', label: 'CLEAN LAP', hint: 'Finish the circuit without recovering.', group: 'minigames', target: 1 },
  { id: 'nameDrop', label: 'NAME DROP', hint: 'Topple all sixteen letters, then restore them at the name stand.', group: 'minigames', target: 16 },
  { id: 'strike', label: 'STRIKE!', hint: 'Knock down all ten bowling pins with your first ball.', group: 'minigames', target: 1 },
  { id: 'spare', label: 'SPARE CHANGE', hint: 'Clear the remaining pins on your second bowling throw.', group: 'minigames', target: 1 },
  { id: 'bowling', label: 'LANE LOGIC', hint: 'Finish a frame at the bowling lane.', group: 'minigames', target: 1 },
  { id: 'debugDash', label: 'ALL GREEN', hint: 'Clear the timed debug dash without hitting a green build.', group: 'minigames', target: 1 },
  { id: 'riverRun', label: 'BRIDGE BUILDER', hint: 'Complete the river crossing route in order.', group: 'minigames', target: 1 },
  { id: 'chipRelay', label: 'CACHE HIT', hint: 'Collect three chips and return each to the cache.', group: 'minigames', target: 1 },
  { id: 'domino', label: 'CHAIN REACTION', hint: 'Detonate every crate in the TNT domino challenge.', group: 'minigames', target: 1 },
  { id: 'deployment', label: 'DEPLOYED', hint: 'Push the release package onto the deployment altar.', group: 'minigames', target: 1 },
  { id: 'chips', label: 'SNACK OVERFLOW', hint: 'Collect twelve chips from the dispenser.', group: 'exploration', target: 12 },
  { id: 'cabin', label: 'OUT OF OFFICE', hint: 'Tip the little forest cabin.', group: 'secrets', target: 1, hidden: true },
  { id: 'waterfall', label: 'QUIET COMMIT', hint: 'Look behind the waterfall.', group: 'secrets', target: 1, hidden: true },
  { id: 'timeMachine', label: 'FUTURE COMMIT', hint: 'Start the time machine in the southern garden.', group: 'secrets', target: 1 },
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
  { id: 'cones', label: 'CLEAN SWEEP', hint: 'Knock over twenty traffic cones.', group: 'driving', target: 20 },
  { id: 'shipIt', label: 'SHIP IT', hint: 'Jump through the brackets.', group: 'driving', target: 1 },

  /* ---- exploration --------------------------------------- */
  { id: 'about', label: 'INTRODUCED', hint: 'Read the ID card at the hub.', group: 'exploration', target: 1 },
  { id: 'kcl', label: 'FOUNDATIONS', hint: 'Visit the KCL campus.', group: 'exploration', target: 1 },
  { id: 'ucl', label: 'NEXT', hint: 'Visit the UCL research shell.', group: 'exploration', target: 1 },
  { id: 'lab', label: 'INSIDE THE LAB', hint: 'Reach the AI lab.', group: 'exploration', target: 1 },
  { id: 'client', label: 'FOURTEEN', hint: 'Find the client city landmark.', group: 'exploration', target: 1 },
  { id: 'explorer', label: 'EXPLORER', hint: 'Enter every signposted district.', group: 'exploration', target: 13 },
  { id: 'sea', label: 'OUT OF BOUNDS', hint: 'Drive past the edge of the world.', group: 'exploration', target: 1 },
  { id: 'notes', label: 'MARGINALIA', hint: 'Find six dev notes.', group: 'exploration', target: 6 },
  // The island no longer has a night, so this is the weather instead:
  // it rains often enough to be found and rarely enough to be a find.
  { id: 'nightDrive', label: 'STORM SHIFT', hint: 'Drive through the rain.', group: 'exploration', target: 1 },

  /* ---- projects ------------------------------------------ */
  { id: 'projects', label: 'READING UP', hint: 'Open ten project panels.', group: 'projects', target: 10 },
  { id: 'archivist', label: 'ARCHIVIST', hint: 'Open every archive island.', group: 'projects', target: 12 },
  { id: 'debugger', label: 'DEBUGGER', hint: 'Knock over every FAIL block in the debug yard.', group: 'projects', target: 8 },

  /* ---- mini-games ---------------------------------------- */
  { id: 'circuit', label: 'CHEQUERED FLAG', hint: 'Finish three laps of the circuit.', group: 'minigames', target: 1 },
  // The bar is `CIRCUIT.laps * CIRCUIT.targetLapSeconds` — two laps at
  // 60 s. The hint used to say sixty seconds for the whole race, which
  // is a time nobody could set for two laps and made the award look
  // broken; it is now what the code actually checks.
  { id: 'speedDemon', label: 'SPEED DEMON', hint: 'Finish the two-lap circuit inside 2:00.', group: 'minigames', target: 1 },
  { id: 'pathFound', label: 'PATH FOUND', hint: 'Reach the centre of the labyrinth.', group: 'minigames', target: 1 },
  { id: 'checkmate', label: 'ENGINE APPROVED', hint: 'Play the engine move at the chess terminal.', group: 'minigames', target: 1 },
  { id: 'contentEngine', label: 'CONTENT ENGINE', hint: 'Complete the Focus video pipeline in order.', group: 'minigames', target: 1 },
  { id: 'retrieval', label: 'RETRIEVAL COMPLETE', hint: 'Retrieve the right cluster in the AI lab.', group: 'minigames', target: 1 },
  { id: 'orderRush', label: 'ORDER FILLED', hint: 'Clear the order book gates in time.', group: 'minigames', target: 1 },
  { id: 'gymCircuit', label: 'FULL SESSION', hint: 'Complete the gym circuit.', group: 'minigames', target: 1 },
  { id: 'chaosTheory', label: 'CHAOS THEORY', hint: 'Destabilise the three-body system.', group: 'minigames', target: 1 },
  { id: 'tunnel', label: 'ENCRYPTED', hint: 'Run the packet gates in order.', group: 'minigames', target: 1 },

  /* ---- secrets ------------------------------------------- */
  { id: 'curious', label: 'CURIOUS', hint: 'Find your first secret.', group: 'secrets', target: 1 },
  { id: 'konami', label: 'UP UP DOWN DOWN', hint: 'You know the one.', group: 'secrets', target: 1 },
  { id: 'devRoom', label: 'UNDER THE SIGN', hint: 'There is a room beneath the hub.', group: 'secrets', target: 1, hidden: true },
  { id: 'duck', label: 'RUBBER DUCK', hint: 'Consult the duck.', group: 'secrets', target: 1, hidden: true },
  { id: 'underground', label: 'BELOW THE CHUNKS', hint: 'Something is buried in the voxel field.', group: 'secrets', target: 1, hidden: true },
  { id: 'ticker', label: 'ANP', hint: 'Find the fictional ticker.', group: 'secrets', target: 1, hidden: true },
  { id: 'hiddenIsland', label: 'THE VOID', hint: 'Some jumps are longer than they look.', group: 'secrets', target: 1, hidden: true },
  { id: 'phoneHop', label: 'OVER THE PHONE', hint: 'Clear the Focus device in one jump.', group: 'secrets', target: 1, hidden: true },
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
  { id: 'secrets', label: 'Secrets' },
]

/** Everything except COMPLETIONIST itself — the set it measures. */
export const completionistTargets = achievements
  .filter((a) => a.id !== 'completionist')
  .map((a) => a.id)
