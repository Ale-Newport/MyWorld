import { Events } from '../core/Events.js';
/* ============================================================
   PORTED FROM: sources/Game/Inputs/Keyboard.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   Emits both `event.code` ("KeyW") and `event.key` ("w") so an
   action can bind either a physical key or a character. Releases
   everything on blur, which is the difference between tabbing
   away and coming back to a car that has stopped, and tabbing
   away and coming back to a car driving into a wall.

   Changes: TypeScript; listeners are attached to a target
   element's document and removed on destroy; a guard so the
   engine never eats a browser shortcut it should not.
   ============================================================ */
/** Combinations the page must never swallow. */
function isBrowserShortcut(event) {
    return event.metaKey || event.ctrlKey || event.altKey;
}
/** Keys whose default we suppress while driving (page scroll, quick-find). */
const PREVENT_DEFAULT = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Space', 'Tab', 'Slash', 'Quote',
]);
export class Keyboard {
    events = new Events();
    pressed = new Set();
    /** While false, keys are read but their default is not prevented. */
    capture = true;
    onKeyDown = (event) => {
        const target = event.target;
        if (target?.matches?.('input, textarea, select, [contenteditable]') && event.code !== 'Escape')
            return;
        if (isBrowserShortcut(event))
            return;
        if (this.capture && PREVENT_DEFAULT.has(event.code))
            event.preventDefault();
        // Browsers repeat held keys; the action layer only wants edges.
        if (event.repeat)
            return;
        this.pressed.add(event.code);
        this.pressed.add(event.key);
        this.events.trigger('down', [event.code, event.key]);
    };
    onKeyUp = (event) => {
        if (!this.pressed.has(event.code) && !this.pressed.has(event.key))
            return;
        this.pressed.delete(event.code);
        this.pressed.delete(event.key);
        this.events.trigger('up', [event.code, event.key]);
    };
    onBlur = () => this.releaseAll();
    onVisibility = () => {
        if (document.visibilityState === 'hidden')
            this.releaseAll();
    };
    constructor() {
        window.addEventListener('keydown', this.onKeyDown, { passive: false });
        window.addEventListener('keyup', this.onKeyUp);
        window.addEventListener('blur', this.onBlur);
        document.addEventListener('visibilitychange', this.onVisibility);
    }
    /** Fires `up` for every held key. Called on blur and on teardown. */
    releaseAll() {
        if (this.pressed.size === 0)
            return;
        for (const key of Array.from(this.pressed)) {
            this.events.trigger('up', [key, key]);
        }
        this.pressed.clear();
    }
    destroy() {
        this.releaseAll();
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('blur', this.onBlur);
        document.removeEventListener('visibilitychange', this.onVisibility);
        this.events.clear();
    }
}
