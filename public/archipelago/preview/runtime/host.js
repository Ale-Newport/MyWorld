import {createHostLink} from './loading.js';
/* This runtime's link to the page that hosts it. Imported before anything else binds an input: embedded in /world
   (the public player inside the leaf cover) it refuses keyboard and pointer input until the host says `live`. */
export const host=createHostLink({win:window,embedded:document.body?.dataset.player==='true'&&window.parent!==window});
host.installGate();
host.listen();
