/**
 * Which design of the boards a prefab was built with. A prefab the studio saved BY VALUE (the Projects board and the Lab are stored in
 * the world document as their own meshes and textures, not as a reference to the library's asset) keeps the faces of the day it was saved:
 * the old black screens stay in the Edit view long after the library's board has become timber and parchment. A board that is built
 * from this kit puts SIGN_DESIGN on its group (`userData.signDesign`), the studio compares it with the one in its saved copy, and a copy
 * with an older design and no part edited by hand is rebuilt from the library on load (editor.js, refreshDefinitionInstances).
 * Raise it when a board's design changes in a way a saved copy should not keep.
 */
export const SIGN_DESIGN = 1
