/**
 * A re-export, and a temporary one.
 *
 * The dressing kit lives one level up, at `src/world/world/kit.ts`,
 * beside the materials and geometry it is built from. Half of the
 * district files reach for it as `'./kit'` and half as `'../kit'`;
 * this makes both spellings resolve while the districts land, and it
 * collapses into the real file once they have.
 */
export * from '../kit'
export type { Dressing, DressingBuilder, BuildContext } from '../kit'
