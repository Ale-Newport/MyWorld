import { Events } from '../core/Events.js';
import { remapClamp } from '../core/maths.js';
/* ============================================================
   PORTED FROM: sources/Game/Inputs/Gamepad.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   Pads do not agree on anything. `mapping === "standard"` covers
   Chrome and Safari everywhere and Xbox pads in Firefox; Firefox
   with a DualSense reports an empty mapping and puts the D-pad on
   a single axis with five magic float values, with different axis
   indices on Windows and macOS. Upstream worked those out by
   hand — the tables below are its findings, kept verbatim,
   because there is no way to re-derive them without the hardware.

   Changes: TypeScript; `getGamepads()` picks the most recently
   *used* pad rather than the last non-null slot, so plugging in a
   second controller does not silently steal input; no DOM class
   side-effects (the UI layer subscribes to `typeChange` instead).
   ============================================================ */
const JOYSTICK_DEAD_ZONE = 0.2;
const BUTTON_PRESSED_ZONE = 0.2;
const STANDARD = [
    { name: 'cross', type: 'button', action: 'buttonRaw', index: 0 },
    { name: 'circle', type: 'button', action: 'buttonRaw', index: 1 },
    { name: 'square', type: 'button', action: 'buttonRaw', index: 2 },
    { name: 'triangle', type: 'button', action: 'buttonRaw', index: 3 },
    { name: 'l1', type: 'button', action: 'buttonRaw', index: 4 },
    { name: 'r1', type: 'button', action: 'buttonRaw', index: 5 },
    { name: 'l2', type: 'button', action: 'buttonRaw', index: 6 },
    { name: 'r2', type: 'button', action: 'buttonRaw', index: 7 },
    { name: 'select', type: 'button', action: 'buttonRaw', index: 8 },
    { name: 'start', type: 'button', action: 'buttonRaw', index: 9 },
    { name: 'l3', type: 'button', action: 'buttonRaw', index: 10 },
    { name: 'r3', type: 'button', action: 'buttonRaw', index: 11 },
    { name: 'up', type: 'button', action: 'buttonRaw', index: 12 },
    { name: 'down', type: 'button', action: 'buttonRaw', index: 13 },
    { name: 'left', type: 'button', action: 'buttonRaw', index: 14 },
    { name: 'right', type: 'button', action: 'buttonRaw', index: 15 },
    { name: 'left', type: 'joystick', action: 'axesToCircle', indexes: [0, 1] },
    { name: 'right', type: 'joystick', action: 'axesToCircle', indexes: [2, 3] },
];
const ARROW_UP = [-1, -0.7142857142857143, 1];
const ARROW_DOWN = [-0.1428571428571429, 0.1428571428571428, 0.4285714285714286];
const ARROW_LEFT = [0.4285714285714286, 0.7142857142857142, 1];
const ARROW_RIGHT = [-0.7142857142857143, -0.4285714285714286, -0.1428571428571429];
const WINDOWS_FIREFOX_PS5 = [
    { name: 'cross', type: 'button', action: 'buttonRaw', index: 1 },
    { name: 'circle', type: 'button', action: 'buttonRaw', index: 2 },
    { name: 'square', type: 'button', action: 'buttonRaw', index: 0 },
    { name: 'triangle', type: 'button', action: 'buttonRaw', index: 3 },
    { name: 'l1', type: 'button', action: 'buttonRaw', index: 4 },
    { name: 'r1', type: 'button', action: 'buttonRaw', index: 5 },
    { name: 'l2', type: 'button', action: 'axisToTrigger', index: 3 },
    { name: 'r2', type: 'button', action: 'axisToTrigger', index: 4 },
    { name: 'select', type: 'button', action: 'buttonRaw', index: 8 },
    { name: 'start', type: 'button', action: 'buttonRaw', index: 9 },
    { name: 'l3', type: 'button', action: 'buttonRaw', index: 10 },
    { name: 'r3', type: 'button', action: 'buttonRaw', index: 11 },
    { name: 'up', type: 'button', action: 'axisToArrow', index: 9, angles: ARROW_UP },
    { name: 'down', type: 'button', action: 'axisToArrow', index: 9, angles: ARROW_DOWN },
    { name: 'left', type: 'button', action: 'axisToArrow', index: 9, angles: ARROW_LEFT },
    { name: 'right', type: 'button', action: 'axisToArrow', index: 9, angles: ARROW_RIGHT },
    { name: 'left', type: 'joystick', action: 'axesToCircle', indexes: [0, 1] },
    { name: 'right', type: 'joystick', action: 'axesToCircle', indexes: [2, 5] },
];
const MACOS_FIREFOX_PS5 = [
    { name: 'cross', type: 'button', action: 'buttonRaw', index: 1 },
    { name: 'circle', type: 'button', action: 'buttonRaw', index: 2 },
    { name: 'square', type: 'button', action: 'buttonRaw', index: 0 },
    { name: 'triangle', type: 'button', action: 'buttonRaw', index: 3 },
    { name: 'l1', type: 'button', action: 'buttonRaw', index: 4 },
    { name: 'r1', type: 'button', action: 'buttonRaw', index: 5 },
    { name: 'l2', type: 'button', action: 'axisToTrigger', index: 4 },
    { name: 'r2', type: 'button', action: 'axisToTrigger', index: 5 },
    { name: 'select', type: 'button', action: 'buttonRaw', index: 8 },
    { name: 'start', type: 'button', action: 'buttonRaw', index: 9 },
    { name: 'l3', type: 'button', action: 'buttonRaw', index: 10 },
    { name: 'r3', type: 'button', action: 'buttonRaw', index: 11 },
    { name: 'up', type: 'button', action: 'axisToArrow', index: 6, angles: ARROW_UP },
    { name: 'down', type: 'button', action: 'axisToArrow', index: 6, angles: ARROW_DOWN },
    { name: 'left', type: 'button', action: 'axisToArrow', index: 6, angles: ARROW_LEFT },
    { name: 'right', type: 'button', action: 'axisToArrow', index: 6, angles: ARROW_RIGHT },
    { name: 'left', type: 'joystick', action: 'axesToCircle', indexes: [0, 1] },
    { name: 'right', type: 'joystick', action: 'axesToCircle', indexes: [2, 3] },
];
function emptyButton(name) {
    return { name, value: 0, pressed: false };
}
function emptyJoystick(name) {
    return { name, x: 0, y: 0, safeX: 0, safeY: 0, angle: 0, radius: 0, safeRadius: 0, active: false };
}
export class GamepadInput {
    events = new Events();
    buttons = new Map();
    joysticks = {
        left: emptyJoystick('left'),
        right: emptyJoystick('right'),
    };
    type = 'default';
    /** True while at least one pad is reporting. */
    connected = false;
    activeIndex = null;
    constructor() {
        for (const map of STANDARD) {
            if (map.type === 'button')
                this.buttons.set(map.name, emptyButton(map.name));
        }
        window.addEventListener('gamepadconnected', this.onConnect);
        window.addEventListener('gamepaddisconnected', this.onDisconnect);
    }
    onConnect = (event) => {
        this.activeIndex = event.gamepad.index;
        this.connected = true;
        this.events.trigger('connected', [event.gamepad.id]);
    };
    onDisconnect = (event) => {
        if (this.activeIndex === event.gamepad.index)
            this.activeIndex = null;
        this.connected = false;
        this.releaseAll();
        this.events.trigger('disconnected');
    };
    mappingFor(pad) {
        if (pad.mapping === 'standard')
            return STANDARD;
        if (pad.axes.length === 10)
            return WINDOWS_FIREFOX_PS5;
        if (pad.axes.length === 7)
            return MACOS_FIREFOX_PS5;
        return STANDARD;
    }
    readPad() {
        const pads = navigator.getGamepads?.();
        if (!pads)
            return null;
        if (this.activeIndex !== null) {
            const pad = pads[this.activeIndex];
            if (pad)
                return pad;
            this.activeIndex = null;
        }
        // Prefer whichever pad is actually being touched.
        let fallback = null;
        for (const pad of pads) {
            if (!pad)
                continue;
            fallback ??= pad;
            const active = pad.buttons.some((b) => b.value > BUTTON_PRESSED_ZONE) ||
                pad.axes.some((a) => Math.abs(a) > JOYSTICK_DEAD_ZONE);
            if (active) {
                this.activeIndex = pad.index;
                return pad;
            }
        }
        return fallback;
    }
    releaseAll() {
        for (const button of this.buttons.values()) {
            if (button.pressed) {
                button.pressed = false;
                button.value = 0;
                this.events.trigger('up', [button]);
            }
        }
        this.joysticks.left = emptyJoystick('left');
        this.joysticks.right = emptyJoystick('right');
    }
    /** Polls the pad. Called once per rendered frame. */
    update() {
        const pad = this.readPad();
        if (!pad) {
            if (this.connected) {
                this.connected = false;
                this.releaseAll();
            }
            return;
        }
        this.connected = true;
        const mapping = this.mappingFor(pad);
        for (const map of mapping) {
            if (map.type === 'button') {
                const saved = this.buttons.get(map.name);
                if (!saved)
                    continue;
                let value = 0;
                if (map.action === 'buttonRaw') {
                    value = pad.buttons[map.index]?.value ?? 0;
                }
                else if (map.action === 'axisToTrigger') {
                    const axis = pad.axes[map.index];
                    if (axis !== undefined)
                        value = axis * 0.5 + 0.5;
                }
                else if (map.action === 'axisToArrow') {
                    const axis = pad.axes[map.index];
                    if (axis !== undefined && map.angles) {
                        for (const angle of map.angles) {
                            if (Math.abs(angle - axis) < 0.1) {
                                value = 1;
                                break;
                            }
                        }
                    }
                }
                const pressed = value > BUTTON_PRESSED_ZONE;
                const oldValue = saved.value;
                const oldPressed = saved.pressed;
                saved.value = value;
                saved.pressed = pressed;
                if (pressed && !oldPressed)
                    this.events.trigger('down', [saved]);
                else if (!pressed && oldPressed)
                    this.events.trigger('up', [saved]);
                if (value !== oldValue)
                    this.events.trigger('change', [saved]);
            }
            else {
                const joystick = this.joysticks[map.name];
                const x = pad.axes[map.indexes[0]] ?? 0;
                const y = pad.axes[map.indexes[1]] ?? 0;
                joystick.x = x;
                joystick.y = y;
                joystick.safeX = remapClamp(Math.abs(x), JOYSTICK_DEAD_ZONE, 1, 0, 1) * Math.sign(x);
                joystick.safeY = remapClamp(Math.abs(y), JOYSTICK_DEAD_ZONE, 1, 0, 1) * Math.sign(y);
                joystick.angle = Math.atan2(y, x);
                joystick.radius = Math.hypot(y, x);
                joystick.safeRadius = remapClamp(joystick.radius, JOYSTICK_DEAD_ZONE, 1, 0, 1);
                joystick.active = joystick.radius > JOYSTICK_DEAD_ZONE;
            }
        }
        let type = 'default';
        if (/xbox/i.test(pad.id))
            type = 'xbox';
        else if (/playstation|dualshock|dualsense|ps\d/i.test(pad.id))
            type = 'playstation';
        if (type !== this.type) {
            this.type = type;
            this.events.trigger('typeChange', [type]);
        }
    }
    destroy() {
        window.removeEventListener('gamepadconnected', this.onConnect);
        window.removeEventListener('gamepaddisconnected', this.onDisconnect);
        this.events.clear();
    }
}
