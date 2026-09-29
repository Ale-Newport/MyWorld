const VARIANT = {
    mouseKeyboard: 'refBlackboardLabelsMouseKeyboard',
    xbox: 'refBlackboardLabelsGamepadXbox',
    playstation: 'refBlackboardLabelsGamepadPlaystation',
};
export class Blackboards {
    references;
    inputs;
    boards = [];
    scheme = 'mouseKeyboard';
    constructor(references, inputs, bin) {
        this.references = references;
        this.inputs = inputs;
        for (const collection of ['blackBoard.001', 'blackBoard.002']) {
            const labels = new Map();
            for (const node of references.collection(collection)) {
                const source = String(node.userData.w2Source ?? node.name);
                // `refBlackboardLabelsGamepadXbox.001` and `…Xbox` are the same
                // variant on different boards: match the stem, ignore the suffix.
                const stem = source.replace(/\.\d+$/, '');
                for (const [scheme, name] of Object.entries(VARIANT)) {
                    if (stem === name)
                        labels.set(scheme, node);
                }
            }
            if (labels.size)
                this.boards.push({ collection, labels });
        }
        this.apply();
        const onMode = () => this.apply();
        const onType = () => this.apply();
        inputs.events.on('modeChange', onMode);
        inputs.gamepad.events.on('typeChange', onType);
        bin.add(() => {
            inputs.events.off('modeChange', onMode);
            inputs.gamepad.events.off('typeChange', onType);
        });
    }
    /** The scheme the boards are currently speaking. Read by the QA harness. */
    get showing() { return this.scheme; }
    /**
     * Touch reads the same board as mouse and keyboard: the atlas has no touch
     * variant, and its words — NEXT, PREV, OPEN, EXIT — are what the on-screen
     * buttons say anyway. A pad of unknown make gets the Xbox face, because
     * ABXY is the labelling most third-party pads print on their buttons.
     */
    choose() {
        if (this.inputs.mode !== 'gamepad')
            return 'mouseKeyboard';
        return this.inputs.gamepad.type === 'playstation' ? 'playstation' : 'xbox';
    }
    /**
     * Suppression rather than a plain `visible = false`: the validation panel's
     * scenery toggle re-derives visibility for every level mesh from its
     * category, and would otherwise light all three variants up again.
     */
    apply() {
        this.scheme = this.choose();
        const environment = this.references.environment;
        for (const board of this.boards) {
            for (const [scheme, node] of board.labels) {
                if (scheme === this.scheme)
                    environment.unsuppress(node);
                else
                    environment.suppress(node);
            }
        }
    }
}
