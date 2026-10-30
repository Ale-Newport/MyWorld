/* The /world player is plain JavaScript (public/archipelago/preview). What is edited here and checked in
   is its sign, board, social and career modules, which talk to the host objects the player hands them.
   Those hosts are not TypeScript, so they are declared loosely; the player's own tests exercise them. */

/** The player's game object (`game.focus`, `game.inputs`, the camera view…). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type World2Game = any

/** The environment the references are read from (`group`, `nodes`, `physicals`, `suppress`, `anchor`…). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type World2Environment = any
