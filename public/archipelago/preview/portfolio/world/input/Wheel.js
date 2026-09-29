import { Events } from '../core/Events.js';
/* ============================================================
   PORTED FROM: sources/Game/Inputs/Wheel.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   Upstream uses the `normalize-wheel` package. That is one more
   dependency for forty lines of arithmetic, so the normalisation
   is inlined here: `deltaMode` 1 is lines and 2 is pages, and a
   trackpad on a Mac reports pixels with a very different scale
   from a mouse notch. Normalising to "roughly one notch = 1"
   keeps zoom sensitivity the same on both.
   ============================================================ */
const LINE_HEIGHT = 40;
const PAGE_HEIGHT = 800;
export class Wheel {
    element;
    events = new Events();
    constructor(element) {
        this.element = element;
        element.addEventListener('wheel', this.onWheel, { passive: false });
    }
    onWheel = (event) => {
        // The world owns its own zoom; letting the page scroll behind it
        // is how a visitor loses the canvas mid-drive.
        event.preventDefault();
        let { deltaX, deltaY } = event;
        if (event.deltaMode === 1) {
            deltaX *= LINE_HEIGHT;
            deltaY *= LINE_HEIGHT;
        }
        else if (event.deltaMode === 2) {
            deltaX *= PAGE_HEIGHT;
            deltaY *= PAGE_HEIGHT;
        }
        // Match normalize-wheel's ~120px-per-notch convention.
        const spinX = deltaX / 120;
        const spinY = deltaY / 120;
        this.events.trigger('roll', [event.shiftKey ? spinX : spinY]);
    };
    destroy() {
        this.element.removeEventListener('wheel', this.onWheel);
        this.events.clear();
    }
}
