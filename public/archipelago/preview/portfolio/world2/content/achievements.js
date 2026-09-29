/* ============================================================
   WORLD 02 ACHIEVEMENTS

   Architecture from sources/Game/Achievements.js (folio-2025,
   MIT — Copyright (c) 2025 Bruno Simon). The list is ours, and
   every row is reachable from something this world actually
   builds. Bruno's personal ones (his awards, his socials, the
   FWA crates) are not retained: they are not achievable here.

   `target` is a count. `unique: true` means progress is a SET of
   ids, so the same crate or the same area cannot be farmed by
   driving in and out.
   ============================================================ */
import { CAREER } from './career.js';
export const WORLD2_ACHIEVEMENTS = [
    { id: 'firstDrive', title: 'First drive', description: 'Cover your first hundred metres.', target: 100, group: 'driving' },
    { id: 'longHaul', title: 'Long haul', description: 'Drive five kilometres around the island.', target: 5000, group: 'driving' },
    { id: 'boosted', title: 'Boosted', description: 'Hold the boost for three seconds straight.', target: 1, group: 'driving' },
    { id: 'takeoff', title: 'Takeoff', description: 'Stay airborne for a full two seconds.', target: 1, group: 'driving' },
    { id: 'speedDemon', title: 'Speed demon', description: 'See 120 km/h on the clock.', target: 1, group: 'driving' },
    { id: 'swimmer', title: 'Not a boat', description: 'Put the car in the water.', target: 1, group: 'driving' },
    { id: 'explorer', title: 'Explorer', description: 'Find all thirteen authored places.', target: 13, unique: true, group: 'places' },
    // The walk carries one stone per stop on all three lanes; the target is
    // whatever the portfolio's own data adds up to, never a number typed here.
    { id: 'career', title: 'Curriculum', description: 'Read every stage of the career walk.', target: CAREER.length, unique: true, group: 'places' },
    { id: 'projects', title: 'Portfolio', description: 'Bring eight different projects up on the big screen.', target: 8, unique: true, group: 'places' },
    { id: 'social', title: 'Say hello', description: 'Find every way to get in touch.', target: 3, unique: true, group: 'places' },
    { id: 'behindTheScene', title: 'Under the hood', description: 'Read how this world is built.', target: 1, group: 'places' },
    { id: 'lab', title: 'Lab rat', description: 'Visit the lab.', target: 1, group: 'places' },
    { id: 'timeMachine', title: 'Rewind', description: 'Start the time machine.', target: 1, group: 'places' },
    { id: 'altar', title: 'Offering', description: 'Leave something at the altar.', target: 1, group: 'places' },
    { id: 'toilet', title: 'Facilities', description: 'Find the throne.', target: 1, group: 'places' },
    { id: 'firstRace', title: 'Participation medal', description: 'Finish a lap of the circuit.', target: 1, group: 'games' },
    { id: 'fastLap', title: 'Quick one', description: 'Finish a lap in under a minute.', target: 1, group: 'games' },
    { id: 'strike', title: 'Strike!', description: 'Knock down all ten pins in one go.', target: 1, group: 'games' },
    { id: 'pins', title: 'Pin chaser', description: 'Knock down fifty pins in total.', target: 50, group: 'games' },
    { id: 'cookies', title: 'Sweet tooth', description: 'Collect ten cookies.', target: 10, group: 'games' },
    { id: 'jukebox', title: 'DJ', description: 'Put something on the jukebox.', target: 1, group: 'games' },
    { id: 'tnt', title: 'Demolition', description: 'Set off a crate of TNT.', target: 1, group: 'mischief' },
    { id: 'tntChain', title: 'Chain reaction', description: 'Take out five crates with one bang.', target: 5, group: 'mischief' },
    { id: 'tntAll', title: 'Nothing left', description: 'Detonate every crate on the island.', target: 23, unique: true, group: 'mischief' },
    { id: 'titleNudge', title: 'Typographer', description: 'Knock a letter of the name over.', target: 1, group: 'mischief' },
    { id: 'titleDestroyer', title: 'Anonymous', description: 'Flatten the whole name.', target: 16, unique: true, group: 'mischief' },
    { id: 'bricks', title: 'Bull in a china shop', description: 'Scatter twenty loose props.', target: 20, unique: true, group: 'mischief' },
];
export const WORLD2_ACHIEVEMENT_BY_ID = Object.fromEntries(WORLD2_ACHIEVEMENTS.map(a => [a.id, a]));
