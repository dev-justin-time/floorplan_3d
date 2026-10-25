import { Wall, ItemFactory } from './items.js';

export class StateManager {
    constructor(appState, onRestore) {
        this.appState = appState;
        this.onRestore = onRestore;
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 50;
        this.isExecuting = false;
    }

    saveState() {
        // Don't save if we are in the middle of a restore
        if (this.isExecuting) return;

        // If we undid some actions, remove the future states
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }

        // Create a deep copy of the relevant state
        // Support both legacy (single floor) and new (multi-story) structures
        const snapshot = {
            // Save global story structure if available, otherwise fallback to single floor data
            stories: this.appState.stories ? this.appState.stories.map(story => ({
                ...story,
                walls: story.walls.map(w => w.toJSON()),
                fixtures: story.fixtures.map(f => f.toJSON())
            })) : null,
            
            // Legacy/Active floor fallback (for backward compatibility or current view reference)
            walls: this.appState.walls.map(w => w.toJSON()),
            fixtures: this.appState.fixtures.map(f => f.toJSON()),
            
            currentStoryIndex: this.appState.currentStoryIndex || 0,
            fixtureStyles: JSON.parse(JSON.stringify(this.appState.fixtureStyles)),
            showRoof: this.appState.showRoof || false,
            showCeiling: this.appState.showCeiling || false
        };

        this.history.push(snapshot);
        this.historyIndex++;

        if (this.history.length > this.maxHistory) {
            this.history.shift();
            this.historyIndex--;
        }
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