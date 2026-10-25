import { Wall, ItemFactory } from './items.js';

export class StateManager {
    constructor(appState, onRestore) {
        this.appState = appState;
        this.onRestore = onRestore;
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 50;
        this.isExecuting = false;
        // Metadata of the last write, used by tagged coalescing (feature 27).
        this.lastSave = { tag: null, at: 0 };
    }

    /**
     * A deep copy of everything undo has to restore. Support both legacy (single
     * floor) and new (multi-story) structures.
     */
    buildSnapshot() {
        return {
            stories: this.appState.stories ? this.appState.stories.map(story => ({
                ...story,
                walls: story.walls.map(w => w.toJSON()),
                fixtures: story.fixtures.map(f => f.toJSON())
            })) : null,

            walls: this.appState.walls.map(w => w.toJSON()),
            fixtures: this.appState.fixtures.map(f => f.toJSON()),

            currentStoryIndex: this.appState.currentStoryIndex || 0,
            fixtureStyles: JSON.parse(JSON.stringify(this.appState.fixtureStyles)),
            roomMaterials: JSON.parse(JSON.stringify(this.appState.roomMaterials || {})),
            showRoof: this.appState.showRoof || false,
            showCeiling: this.appState.showCeiling || false,
            // Undo should not silently change the grid size.
            gridSize: this.appState.gridSize || 30
        };
    }

    saveState(tag = null) {
        // Don't save if we are in the middle of a restore
        if (this.isExecuting) return;

        // If we undid some actions, remove the future states
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }

        this.history.push(this.buildSnapshot());
        this.historyIndex++;
        this.lastSave = { tag, at: Date.now() };

        if (this.history.length > this.maxHistory) {
            this.history.shift();
            this.historyIndex--;
        }
    }

    /** Replace the snapshot at the top of the stack (coalesced edits). */
    replaceTop() {
        if (this.historyIndex < 0) return;
        this.history[this.historyIndex] = this.buildSnapshot();
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.restore(this.history[this.historyIndex]);
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.restore(this.history[this.historyIndex]);
        }
    }

    restore(snapshot) {
        this.isExecuting = true;
        if (this.onRestore) {
            this.onRestore(snapshot);
        }
        this.isExecuting = false;
    }
}