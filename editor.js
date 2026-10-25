import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { ConversionEngine3D } from './3dConversionEngine.js';
import { Wall, ItemFactory, itemDimensions } from './items.js';
import { StateManager } from './state-manager.js';
import { StorageManager } from './storage.js';
import { FloorPlanProcessor } from './floorPlanProcessor.js';
import { graphFromWalls } from './floorplan-graph.js';
import { measurePlan } from './measurements.js';
import { PIXELS_PER_METER, WALL_HEIGHT } from './world-space.js';
import { fitCameraToGraph } from './scene-camera.js';
import { fixtureAt, beginDrag, dragTo } from './scene-drag.js';
import { snapToWalls } from './wall-snap.js';
import { createItemGizmo, planFromObject, pickItemId } from './scene-gizmo.js';
import { createElevationDrag, frameElevation, applyElevationVisibility, ELEVATION_SIDES } from './scene-elevation.js';
import { createSceneAbilities, apply3DAbilities } from './scene-abilities.js';
import { drawPlanOverlays, drawScreenOverlays } from './plan-overlays.js';

// Application State
const AppState = {
    viewMode: '2d',
    currentTool: 'wall',
    isDrawing: false,
    wallStart: null,
    walls: [],
    fixtures: [],
    selectedFixture: null,
    // Selected wall id; drives the wall highlight in 2D/3D and the inspector.
    selectedWallId: null,
    drag: null,
    // Ruler points ({ start, end }) and the last pointer position in plan space.
    ruler: { start: null, end: null },
    cursor: null,
    // Wall endpoint being dragged in the plan ({ id, end: 'start' | 'end' }).
    wallNodeDrag: null,
    // Mesh height and item lift captured when the 3D gizmo attaches, so a Y
    // drag can be expressed as a change in the item's elevation.
    gizmoBase: null,
    
    // Settings
    showDimensions: true,
    showCeiling: false,
    showRoof: false,
    gridSize: 30,
    
    // Viewport
    scale: 1,
    offset: { x: 0, y: 0 },
    isPanning: false,
    panStart: { x: 0, y: 0 },
    
    // Elevation view ('front' | 'back' | 'left' | 'right'); null is the 3D orbit
    elevationSide: null,
    
    // Background
    backgroundImage: null,
    backgroundScale: 1.0, // Added scale property
    
    // Styles
    fixtureStyles: {},
    defaultWallTexture: null,
    defaultFloorTexture: 'tile'
};

// Systems
let blueprintCanvas, blueprintCtx;
let scene3D, camera3D, renderer3D, controls3D;
let orthoCamera3D, orthoControls3D; // side elevation views
let elevationBounds = null, elevationDrag = null;
let abilities = null;
let gridHelper3D = null, axesHelper3D = null;
let conversionEngine;
let itemGizmo;
let gizmoMode = 'translate';
let stateManager;

// Constants
const SCALE = 30; // Pixels per meter approximation for internal logic

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    init();
    showWelcomeToast();
});

function init() {
    console.log('Initializing Floorplan 3D Editor v1.0.0');
    
    // Setup State Manager
    stateManager = new StateManager(AppState, restoreState);
    
    init2D();
    init3D();
    setupEventListeners();
    wireUploadModal(); // Initialize modal handlers
    initAbilities(); // 49 scene abilities + their panel
    
    // Load Autosave
    const saved = StorageManager.loadProject('autosave');
    if (saved) {
        restoreState(saved);
        console.log('Restored from autosave');
    }

    // Initial Draw
    onResize();
    draw2D();
    updateViewButtons();
    
    // Expose Global API
    window.undo = () => { stateManager.undo(); updateUI(); };
    window.redo = () => { stateManager.redo(); updateUI(); };
    window.toggleView = toggleView;
    window.setViewMode = (mode) => setViewMode(mode);
    window.setElevationView = setElevationView;
    // Dimensions are an ability toggle, so the header switch flips the same flag.
    window.toggleDimensions = () => {
        if (abilities) abilities.toggle('dimensions');
        else { AppState.showDimensions = !AppState.showDimensions; draw2D(); }
    };
    window.toggleCeiling = () => { AppState.showCeiling = !AppState.showCeiling; update3D(); };
    window.toggleRoof = () => { AppState.showRoof = !AppState.showRoof; update3D(); };
    window.setWallHeight = (value) => {
        const wall = selectedWall();
        const height = parseFloat(value);
        if (!wall || !Number.isFinite(height) || height <= 0) return;
        wall.height = height;
        saveAndSync();
    };
    window.setItemSize = (key, value) => {
        const fixture = AppState.selectedFixture;
        const metres = parseFloat(value) / 100;
        if (!fixture || !Number.isFinite(metres) || metres <= 0) return;
        if (!fixture.size) fixture.size = {};
        fixture.size[key] = metres;
        saveAndSync();
    };
    window.setItemRotation = (value) => {
        const fixture = AppState.selectedFixture;
        const radians = (parseFloat(value) * Math.PI) / 180;
        if (!fixture || !Number.isFinite(radians)) return;
        fixture.rotation = radians;
        saveAndSync();
    };
    window.deleteSelectedWall = deleteSelectedWall;
    window.deleteSelected = deleteSelected;
    window.duplicateSelected = duplicateSelected;
    window.toggleSelectedVisibility = () => {
        const fixture = AppState.selectedFixture;
        if (!fixture) return;
        fixture.visible = fixture.visible === false;
        // A hidden piece cannot be dragged or gizmo'd.
        if (fixture.visible === false) AppState.drag = null;
        saveAndSync();
        refreshGizmo();
    };
    window.toggleSelectedLock = () => {
        const fixture = AppState.selectedFixture;
        if (!fixture) return;
        fixture.locked = !fixture.locked;
        if (fixture.locked) AppState.drag = null;
        saveAndSync();
        refreshGizmo();
    };
    window.exportProject = exportProject;
    window.export3D = export3D;
    window.setBgScale = (val) => {
        AppState.backgroundScale = parseFloat(val);
        document.getElementById('bg-scale-val').textContent = val + 'x';
        draw2D();
    };
    window.clearProject = clearProject;
}

function showWelcomeToast() {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-gray-900 text-white px-6 py-4 rounded-lg shadow-xl transform transition-all duration-500 translate-y-20 z-50 flex items-center gap-4';
    toast.innerHTML = `
        <div class="bg-primary/20 p-2 rounded-full">
            <span class="material-symbols-outlined text-primary">auto_awesome</span>
        </div>
        <div>
            <h4 class="font-bold">Welcome to Studio</h4>
            <p class="text-sm text-gray-400">Start drawing walls or upload a plan to begin.</p>
        </div>
        <button onclick="this.parentElement.remove()" class="text-gray-500 hover:text-white">
            <span class="material-symbols-outlined">close</span>
        </button>
    `;
    document.body.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-20');
    });
    
    // Auto dismiss
    setTimeout(() => {
        if(toast.parentElement) {
            toast.classList.add('translate-y-20', 'opacity-0');
            setTimeout(() => toast.remove(), 500);
        }
    }, 5000);
}

// ------------------------------------------------------------------
// 2D Logic
// ------------------------------------------------------------------

function init2D() {
    blueprintCanvas = document.getElementById('blueprint-canvas');
    if (!blueprintCanvas) return;
    blueprintCtx = blueprintCanvas.getContext('2d');
}

/** Exact plan position of a pointer event, without grid snapping. */
function getPlanCoordinates(event) {
    const rect = blueprintCanvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left - AppState.offset.x) / AppState.scale,
        y: (event.clientY - rect.top - AppState.offset.y) / AppState.scale
    };
}

function getCanvasCoordinates(event) {
    let { x, y } = getPlanCoordinates(event);
    
    // Snap to grid
    if (AppState.gridSize > 0 && !event.shiftKey) {
        x = Math.round(x / AppState.gridSize) * AppState.gridSize;
        y = Math.round(y / AppState.gridSize) * AppState.gridSize;
    }
    
    return { x, y };
}

function onPointerDown(e) {
    if (e.button === 2 || e.buttons === 4) { // Right click or middle click
        AppState.isPanning = true;
        AppState.panStart = { x: e.clientX, y: e.clientY };
        blueprintCanvas.style.cursor = 'grabbing';
        return;
    }

    const pos = getCanvasCoordinates(e);
    AppState.cursor = pos;

    // Ruler takes clicks ahead of the current tool: first click sets the start,
    // second the end, a third click begins a new measurement.
    if (abilitiesState().ruler) {
        const ruler = AppState.ruler || {};
        if (!ruler.start || ruler.end) AppState.ruler = { start: pos, end: null };
        else AppState.ruler = { start: ruler.start, end: pos };
        draw2D(pos);
        return;
    }

    // Handle Tool Interaction
    if (AppState.currentTool === 'wall') {
        AppState.isDrawing = true;
        AppState.wallStart = pos;
    } else if (AppState.currentTool === 'delete') {
        deleteObjectAt(pos.x, pos.y);
    } else if (AppState.currentTool === 'select') {
        // Wall endpoints first: they sit on top of the wall line so reshaping a
        // corner wins over selecting the whole wall.
        const node = wallNodeAt(pos);
        if (node) {
            AppState.wallNodeDrag = node;
            AppState.selectedWallId = node.id;
            AppState.selectedFixture = null;
            AppState.drag = null;
            draw2D(pos);
            refreshGizmo();
            syncSelectionPanels();
            return;
        }

        const fixture = fixtureAt(AppState.fixtures, pos, { slack: 10 / AppState.scale });
        AppState.selectedFixture = fixture;
        AppState.selectedWallId = fixture ? null : wallAt(pos);

        // Locked (or hidden) pieces can be selected and inspected, but never
        // dragged until they are unlocked.
        const movable = fixture && !fixture.locked && fixture.visible !== false;
        AppState.drag = movable ? beginDrag(fixture, pos) : null;
        draw2D(pos);
        refreshGizmo();
        syncSelectionPanels();
    } else if (AppState.currentTool) {
        // Place item
        const item = ItemFactory.create(AppState.currentTool, pos.x, pos.y);
        
        // In-wall items ride the wall centreline; floor items sit flush on the
        // wall face, width along the wall. Both are ability-controlled.
        const abilityState = abilitiesState();
        if (item.metadata?.type === 'in_wall' || item.metadata?.type === 'in_wall_floor') {
            if (abilityState.wallSnap !== false && item.snapToWall) item.snapToWall(AppState.walls);
        } else if (abilityState.wallSnap !== false) {
            snapToWalls(item, AppState.walls, { threshold: 24 / AppState.scale });
        }
        
        // Default style for new items
        if (!AppState.fixtureStyles[item.id]) {
            AppState.fixtureStyles[item.id] = { 
                color: item.metadata.color ? '#' + item.metadata.color.toString(16).padStart(6, '0') : '#13a4ec', 
                material: 'gloss' 
            };
        }

        AppState.fixtures.push(item);
        
        // Save & Update
        saveAndSync();
        
        // Reset tool to default after placement (optional UX choice)
        // setTool('select'); 
    }
}

function onPointerMove(e) {
    if (AppState.isPanning) {
        const dx = e.clientX - AppState.panStart.x;
        const dy = e.clientY - AppState.panStart.y;
        AppState.offset.x += dx;
        AppState.offset.y += dy;
        AppState.panStart = { x: e.clientX, y: e.clientY };
        draw2D();
        return;
    }

    if (AppState.wallNodeDrag) {
        const nodePos = getCanvasCoordinates(e);
        moveWallNode(nodePos, e.shiftKey);
        draw2D(nodePos);
        scheduleDragUpdate();
        return;
    }

    if (AppState.drag) {
        const dragPos = getCanvasCoordinates(e);
        const abilityState = abilitiesState();
        dragTo(AppState.drag, dragPos, AppState.walls, {
            gridSize: abilityState.gridSnap === false ? 0 : AppState.gridSize,
            snapThreshold: 20 / AppState.scale,
            wallSnap: abilityState.wallSnap !== false
        });
        draw2D(dragPos);
        scheduleDragUpdate();
        return;
    }

    const pos = getCanvasCoordinates(e);
    
    // Redraw for hover effects / previews
    draw2D(pos); 
}

function onPointerUp(e) {
    if (AppState.isPanning) {
        AppState.isPanning = false;
        blueprintCanvas.style.cursor = 'crosshair';
        return;
    }

    if (AppState.wallNodeDrag) {
        AppState.wallNodeDrag = null;
        saveAndSync();
        draw2D();
        return;
    }

    if (AppState.drag) {
        const dragged = AppState.drag.fixture;
        const snappedWall = AppState.drag.snappedWall;
        AppState.drag = null;

        // "Turn to wall": align the piece with the wall it landed on.
        if (dragged && abilitiesState().autoRotateToWall) {
            const wall = snappedWall || nearestWall(dragged);
            if (wall) dragged.rotation = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
        }

        saveAndSync();
        draw2D();
        return;
    }

    if (AppState.isDrawing && AppState.currentTool === 'wall') {
        const rawEnd = getCanvasCoordinates(e);
        const start = AppState.wallStart;
        // Shift constrains the angle to 15° steps while drawing.
        const end = e.shiftKey ? snapAngle(start, rawEnd) : rawEnd;
        
        // Min length check (approx 30cm)
        if (Math.hypot(end.x - start.x, end.y - start.y) > 10) {
            AppState.walls.push(new Wall(start.x, start.y, end.x, end.y));
            saveAndSync();
        }
        
        AppState.isDrawing = false;
        AppState.wallStart = null;
        draw2D();
    }
}

function onWheel(e) {
    e.preventDefault();
    const zoomIntensity = 0.1;
    const wheel = e.deltaY < 0 ? 1 : -1;
    const zoom = Math.exp(wheel * zoomIntensity);
    
    // Zoom towards mouse pointer
    const rect = blueprintCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    AppState.offset.x -= (mouseX - AppState.offset.x) * (zoom - 1);
    AppState.offset.y -= (mouseY - AppState.offset.y) * (zoom - 1);
    AppState.scale *= zoom;
    
    draw2D();
}

/** Double-clicking a wall splits it at the clicked point (inheriting its height). */
function onDoubleClick(e) {
    if (AppState.viewMode !== '2d') return;
    // Hit-test the exact point: grid snapping here would miss walls that do not
    // sit on the grid.
    const pos = getPlanCoordinates(e);
    const id = wallAt(pos);
    if (!id) return;

    const wall = AppState.walls.find((item) => item.id === id);
    if (!wall) return;

    const t = projectionOnSegment(pos, wall.start, wall.end);
    if (t <= 0.05 || t >= 0.95) return;

    const point = {
        x: wall.start.x + (wall.end.x - wall.start.x) * t,
        y: wall.start.y + (wall.end.y - wall.start.y) * t
    };

    const tail = new Wall(point.x, point.y, wall.end.x, wall.end.y, wall.thickness, null, wall.height);
    wall.end = { ...point };
    AppState.walls.push(tail);
    AppState.selectedWallId = tail.id;
    saveAndSync();
}

function deleteObjectAt(x, y) {
    const threshold = 20 / AppState.scale;
    
    // Check fixtures (reverse order)
    for (let i = AppState.fixtures.length - 1; i >= 0; i--) {
        const f = AppState.fixtures[i];
        // Simple radius check, could be bounding box
        if (Math.hypot(f.x - x, f.y - y) < 20) {
            AppState.fixtures.splice(i, 1);
            saveAndSync();
            return;
        }
    }
    
    // Check walls (center)
    for (let i = AppState.walls.length - 1; i >= 0; i--) {
        const w = AppState.walls[i];
        const midX = (w.start.x + w.end.x) / 2;
        const midY = (w.start.y + w.end.y) / 2;
        if (Math.hypot(midX - x, midY - y) < 20) {
            AppState.walls.splice(i, 1);
            saveAndSync();
            return;
        }
    }
}

// ------------------------------------------------------------------
// Selection: walls and item actions
// ------------------------------------------------------------------

/** Snaps a point to 15° steps around an anchor, keeping its distance. */
function snapAngle(anchor, point, stepDegrees = 15) {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const length = Math.hypot(dx, dy);
    const step = (stepDegrees * Math.PI) / 180;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    return { x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length };
}

/** 0..1 position of the closest point on a segment. */
function projectionOnSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) return 0;
    return Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
}

function distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) return Math.hypot(point.x - start.x, point.y - start.y);

    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Id of the wall within a few screen pixels of a plan point, or null. */
function wallAt(pos) {
    const threshold = 12 / AppState.scale;
    let closest = null;
    let closestDistance = Infinity;

    AppState.walls.forEach((wall) => {
        const distance = distanceToSegment(pos, wall.start, wall.end);
        if (distance < threshold && distance < closestDistance) {
            closest = wall.id;
            closestDistance = distance;
        }
    });

    return closest;
}

function selectedWall() {
    return AppState.walls.find((wall) => wall.id === AppState.selectedWallId) || null;
}

/** Closest wall to a fixture centre (turn-to-wall ability). */
function nearestWall(fixture) {
    let closest = null;
    let closestDistance = Infinity;

    AppState.walls.forEach((wall) => {
        const distance = distanceToSegment(fixture, wall.start, wall.end);
        if (distance < closestDistance) {
            closest = wall;
            closestDistance = distance;
        }
    });

    return closest;
}

/** Wall endpoint within a few screen pixels of a plan point. */
function wallNodeAt(pos) {
    const threshold = 10 / AppState.scale;
    for (let i = 0; i < AppState.walls.length; i++) {
        const wall = AppState.walls[i];
        if (Math.hypot(wall.start.x - pos.x, wall.start.y - pos.y) < threshold) return { id: wall.id, end: 'start' };
        if (Math.hypot(wall.end.x - pos.x, wall.end.y - pos.y) < threshold) return { id: wall.id, end: 'end' };
    }
    return null;
}

/** Move the dragged endpoint, snapping to the grid and to other endpoints. */
function moveWallNode(pos, constrainAngle = false) {
    const drag = AppState.wallNodeDrag;
    if (!drag) return;
    const wall = AppState.walls.find((item) => item.id === drag.id);
    if (!wall) return;

    // Shift locks the runaway angle to 15° steps from the opposite end.
    if (constrainAngle) {
        pos = snapAngle(drag.end === 'start' ? wall.end : wall.start, pos);
    }

    const abilityState = abilitiesState();
    const step = AppState.gridSize;
    let x = abilityState.gridSnap === false ? pos.x : Math.round(pos.x / step) * step;
    let y = abilityState.gridSnap === false ? pos.y : Math.round(pos.y / step) * step;

    if (abilityState.joinSnap === false) {
        if (drag.end === 'start') wall.start = { x, y };
        else wall.end = { x, y };
        return;
    }

    const joinThreshold = 12 / AppState.scale;
    AppState.walls.forEach((other) => {
        if (other.id === wall.id) return;
        [other.start, other.end].forEach((point) => {
            if (Math.hypot(point.x - x, point.y - y) < joinThreshold) {
                x = point.x;
                y = point.y;
            }
        });
    });

    if (drag.end === 'start') wall.start = { x, y };
    else wall.end = { x, y };
}

function setPanelText(id, text) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
}

/** Mirrors the current fixture/wall selection into the sidebar inspector. */
function syncSelectionPanels() {
    const itemPane = document.getElementById('selection-item');
    const wallPane = document.getElementById('selection-wall');
    const emptyPane = document.getElementById('selection-empty');
    if (!itemPane || !wallPane) return;

    const fixture = AppState.selectedFixture;
    const wall = selectedWall();

    itemPane.classList.toggle('hidden', !fixture);
    wallPane.classList.toggle('hidden', !wall);
    if (emptyPane) emptyPane.classList.toggle('hidden', !!(fixture || wall));

    if (fixture) {
        setPanelText('sel-item-name', fixture.metadata?.label || fixture.type.replace(/_/g, ' '));
        setPanelText('sel-item-pos', `${(fixture.x / SCALE).toFixed(2)} , ${(fixture.y / SCALE).toFixed(2)} m`);
        setPanelText('sel-item-elev', `${(fixture.elevation || 0).toFixed(2)} m`);
        setPanelText('sel-item-visible', fixture.visible === false ? 'Show' : 'Hide');
        setPanelText('sel-item-lock', fixture.locked ? 'Unlock' : 'Lock');

        const dims = itemDimensions(fixture);
        const sizeFields = { 'sel-item-width': dims.width, 'sel-item-depth': dims.depth, 'sel-item-height': dims.height };
        Object.entries(sizeFields).forEach(([id, metres]) => {
            const input = document.getElementById(id);
            if (input && document.activeElement !== input) input.value = Math.round(metres * 100);
        });
        const rotation = document.getElementById('sel-item-rotation');
        if (rotation && document.activeElement !== rotation) rotation.value = Math.round((fixture.rotation * 180) / Math.PI);
    }

    if (wall) {
        setPanelText('sel-wall-len', `${(wall.length / SCALE).toFixed(2)} m`);
        const heightInput = document.getElementById('sel-wall-height');
        if (heightInput && document.activeElement !== heightInput) {
            heightInput.value = (wall.height ?? 2.7).toFixed(1);
        }
    }
}

function duplicateSelected() {
    const fixture = AppState.selectedFixture;
    if (!fixture) return;

    const data = fixture.toJSON();
    delete data.id; // let the factory mint a fresh id
    data.x = fixture.x + 0.3 * SCALE;
    data.y = fixture.y + 0.3 * SCALE;
    const copy = ItemFactory.fromJSON(data);

    if (AppState.fixtureStyles[fixture.id]) {
        AppState.fixtureStyles[copy.id] = { ...AppState.fixtureStyles[fixture.id] };
    }

    AppState.fixtures.push(copy);
    AppState.selectedFixture = copy;
    AppState.selectedWallId = null;
    saveAndSync();
}

function deleteSelected() {
    const fixture = AppState.selectedFixture;
    if (!fixture) return;

    AppState.fixtures = AppState.fixtures.filter((item) => item.id !== fixture.id);
    delete AppState.fixtureStyles[fixture.id];
    AppState.selectedFixture = null;
    saveAndSync();
}

function deleteSelectedWall() {
    const wall = selectedWall();
    if (!wall) return;

    AppState.walls = AppState.walls.filter((item) => item.id !== wall.id);
    // Openings lose their host wall rather than disappearing with it.
    AppState.fixtures.forEach((fixture) => {
        if (fixture.boundToWallId === wall.id) fixture.boundToWallId = null;
    });
    AppState.selectedWallId = null;
    saveAndSync();
}

// ------------------------------------------------------------------
// Scene abilities (49)
// ------------------------------------------------------------------

function abilitiesState() {
    return abilities ? abilities.state : {};
}

/** Keeps the plan/3D in step with the ability flags. */
function refreshAbilities() {
    const state = abilitiesState();
    AppState.showDimensions = Boolean(state.dimensions);

    if (scene3D) {
        apply3DAbilities(
            { scene: scene3D, renderer: renderer3D, controls: AppState.elevationSide ? orthoControls3D : controls3D },
            state,
            { grid: gridHelper3D, axes: axesHelper3D }
        );
    }

    applyAbilityPanel();
    draw2D();
}

/** Re-reads toggle state into the rendered panel (actions do not need it). */
function applyAbilityPanel() {
    const container = document.getElementById('abilities-list');
    if (!container || !abilities) return;

    container.querySelectorAll('[data-ability]').forEach((node) => {
        const ability = abilities.list.find((entry) => entry.id === node.dataset.ability);
        if (!ability || ability.kind !== 'toggle') return;
        const checkbox = node.querySelector('input');
        if (checkbox) checkbox.checked = Boolean(abilities.state[ability.key]);
    });
}

function renderAbilityPanel() {
    const container = document.getElementById('abilities-list');
    if (!container || !abilities) return;

    container.innerHTML = '';
    let currentGroup = null;
    let groupWrap = null;

    abilities.list.forEach((ability) => {
        if (ability.group !== currentGroup) {
            currentGroup = ability.group;
            groupWrap = document.createElement('div');
            groupWrap.className = 'mt-2';
            const heading = document.createElement('p');
            heading.className = 'text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1';
            heading.textContent = ability.group;
            groupWrap.appendChild(heading);
            container.appendChild(groupWrap);
        }

        if (ability.kind === 'toggle') {
            const row = document.createElement('label');
            row.dataset.ability = ability.id;
            row.className = 'flex items-center justify-between gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer';

            const text = document.createElement('span');
            text.className = 'text-xs text-gray-700 dark:text-gray-200';
            text.textContent = ability.label;

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'rounded border-gray-300 text-primary focus:ring-primary';
            input.checked = Boolean(abilities.state[ability.key]);
            input.addEventListener('change', () => abilities.toggle(ability.id));

            row.append(text, input);
            groupWrap.appendChild(row);
        } else {
            const button = document.createElement('button');
            button.dataset.ability = ability.id;
            button.className = 'w-full text-left px-2 py-1 rounded-lg text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800';
            button.textContent = ability.label;
            button.addEventListener('click', () => abilities.toggle(ability.id));
            groupWrap.appendChild(button);
        }
    });

    const count = document.querySelector('[data-ability-count]');
    if (count) count.textContent = `${abilities.list.length} abilities`;
}

function initAbilities() {
    abilities = createSceneAbilities({
        refresh: refreshAbilities,
        rotateSelection,
        mirrorSelection,
        nudgeSelection,
        duplicateSelection: duplicateSelected,
        alignSelection,
        distributeSelection,
        toggleLockAll,
        toggleHideAll,
        deleteHidden,
        resetElevations,
        snapWallsToGrid,
        centerPlan,
        resetWallHeights,
        cycleWallThickness,
        removeShortWalls,
        exportCutList,
        arrayDuplicateSelection,
        copySelection,
        pasteSelection,
        savePreset: saveAbilityPreset,
        loadPreset: loadAbilityPreset
    });

    renderAbilityPanel();
    refreshAbilities();
}

// --- Ability actions -------------------------------------------------

function rotateSelection(delta) {
    const fixture = AppState.selectedFixture;
    if (!fixture) return;
    fixture.rotation += delta;
    saveAndSync();
}

function mirrorSelection() {
    const fixture = AppState.selectedFixture;
    if (!fixture) return;
    fixture.rotation = -fixture.rotation;
    saveAndSync();
}

function nudgeSelection(dxMetres, dyMetres) {
    const fixture = AppState.selectedFixture;
    if (!fixture || fixture.locked) return;
    fixture.x += dxMetres * SCALE;
    fixture.y += dyMetres * SCALE;
    saveAndSync();
}

const footprintWidth = (fixture) => (fixture.metadata?.width || 0.5) * SCALE;

function alignSelection() {
    const items = AppState.fixtures.filter((fixture) => fixture.visible !== false);
    if (items.length < 2) return;

    // Align the left edges of the footprints, not the centres, so mixed-size
    // cabinets line up the way a run would.
    const leftEdge = (fixture) => fixture.x - footprintWidth(fixture) / 2;
    const leftmost = Math.min(...items.map(leftEdge));
    items.forEach((fixture) => { fixture.x = leftmost + footprintWidth(fixture) / 2; });
    saveAndSync();
}

function distributeSelection() {
    const items = [...AppState.fixtures].sort((a, b) => a.x - b.x);
    if (items.length < 3) return;

    const first = items[0].x;
    const last = items[items.length - 1].x;

    if (Math.abs(last - first) < 1) {
        // Already on one line: spread from the centre in 0.75 m steps instead of
        // collapsing them again.
        const step = 0.75 * SCALE;
        const start = (first + last) / 2 - (step * (items.length - 1)) / 2;
        items.forEach((fixture, index) => { fixture.x = start + step * index; });
    } else {
        const step = (last - first) / (items.length - 1);
        items.forEach((fixture, index) => { fixture.x = first + step * index; });
    }

    saveAndSync();
}

function toggleLockAll() {
    const anyUnlocked = AppState.fixtures.some((fixture) => !fixture.locked);
    AppState.fixtures.forEach((fixture) => { fixture.locked = anyUnlocked; });
    saveAndSync();
}

function toggleHideAll() {
    const anyVisible = AppState.fixtures.some((fixture) => fixture.visible !== false);
    AppState.fixtures.forEach((fixture) => { fixture.visible = !anyVisible; });
    saveAndSync();
}

function deleteHidden() {
    AppState.fixtures = AppState.fixtures.filter((fixture) => fixture.visible !== false);
    saveAndSync();
}

function resetElevations() {
    AppState.fixtures.forEach((fixture) => { fixture.elevation = 0; });
    saveAndSync();
}

function snapWallsToGrid() {
    const step = AppState.gridSize;
    const snap = (value) => Math.round(value / step) * step;
    AppState.walls.forEach((wall) => {
        wall.start = { x: snap(wall.start.x), y: snap(wall.start.y) };
        wall.end = { x: snap(wall.end.x), y: snap(wall.end.y) };
    });
    saveAndSync();
}

function centerPlan() {
    if (AppState.walls.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    AppState.walls.forEach((wall) => {
        minX = Math.min(minX, wall.start.x, wall.end.x);
        maxX = Math.max(maxX, wall.start.x, wall.end.x);
        minY = Math.min(minY, wall.start.y, wall.end.y);
        maxY = Math.max(maxY, wall.start.y, wall.end.y);
    });

    const dx = (minX + maxX) / 2;
    const dy = (minY + maxY) / 2;
    AppState.walls.forEach((wall) => {
        wall.start = { x: wall.start.x - dx, y: wall.start.y - dy };
        wall.end = { x: wall.end.x - dx, y: wall.end.y - dy };
    });
    AppState.fixtures.forEach((fixture) => {
        fixture.x -= dx;
        fixture.y -= dy;
    });
    saveAndSync();
}

function resetWallHeights() {
    AppState.walls.forEach((wall) => { wall.height = null; });
    saveAndSync();
}

function cycleWallThickness() {
    const options = [10, 15, 20];
    const current = AppState.walls[0]?.thickness ?? options[0];
    const next = options[(options.indexOf(current) + 1) % options.length] || options[0];
    AppState.walls.forEach((wall) => { wall.thickness = next; });
    saveAndSync();
}

function removeShortWalls() {
    const minimum = 0.2 * SCALE;
    const keep = AppState.walls.filter((wall) => wall.length >= minimum);
    if (keep.length === AppState.walls.length) return;

    const removed = new Set(AppState.walls.filter((wall) => wall.length < minimum).map((wall) => wall.id));
    AppState.walls = keep;
    AppState.fixtures.forEach((fixture) => {
        if (removed.has(fixture.boundToWallId)) fixture.boundToWallId = null;
    });
    saveAndSync();
}

function exportCutList() {
    const rows = [['type', 'label', 'width_m', 'depth_m', 'height_m', 'x_m', 'y_m', 'elevation_m']];
    AppState.fixtures.forEach((fixture) => {
        const meta = fixture.metadata || {};
        rows.push([
            fixture.type,
            meta.label || fixture.type,
            (meta.width || 0).toFixed(3),
            (meta.depth || 0).toFixed(3),
            (meta.height || 0).toFixed(3),
            (fixture.x / SCALE).toFixed(2),
            (fixture.y / SCALE).toFixed(2),
            (fixture.elevation || 0).toFixed(2)
        ]);
    });

    const blob = new Blob([rows.map((row) => row.join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cut-list.csv';
    link.click();
    URL.revokeObjectURL(url);
}

// --- More item/plan abilities ---------------------------------------

let itemClipboard = null;

function arrayDuplicateSelection(count = 3, spacing = 0.65) {
    const fixture = AppState.selectedFixture;
    if (!fixture) return;

    for (let index = 1; index <= count; index++) {
        const data = fixture.toJSON();
        delete data.id;
        data.x = fixture.x + spacing * SCALE * index;
        data.y = fixture.y;
        const copy = ItemFactory.fromJSON(data);
        AppState.fixtures.push(copy);
        if (AppState.fixtureStyles[fixture.id]) {
            AppState.fixtureStyles[copy.id] = { ...AppState.fixtureStyles[fixture.id] };
        }
    }

    saveAndSync();
}

function copySelection() {
    const fixture = AppState.selectedFixture;
    if (!fixture) return;
    itemClipboard = fixture.toJSON();
}

function pasteSelection() {
    if (!itemClipboard) return;

    const data = {
        ...itemClipboard,
        x: itemClipboard.x + 0.4 * SCALE,
        y: itemClipboard.y + 0.4 * SCALE
    };
    delete data.id;

    const copy = ItemFactory.fromJSON(data);
    AppState.fixtures.push(copy);
    AppState.selectedFixture = copy;
    AppState.selectedWallId = null;
    saveAndSync();
}

function saveAbilityPreset() {
    if (!abilities) return;
    StorageManager.saveProject('ability-preset', { version: 1, state: { ...abilities.state } });
}

function loadAbilityPreset() {
    if (!abilities) return;
    const preset = StorageManager.loadProject('ability-preset');
    if (!preset || !preset.state) return;

    Object.keys(abilities.state).forEach((key) => {
        if (typeof preset.state[key] === 'boolean') abilities.state[key] = preset.state[key];
    });

    refreshAbilities();
}

function draw2D(cursorPos = null) {
    const ctx = blueprintCtx;
    if (!ctx) return;
    const w = blueprintCanvas.width;
    const h = blueprintCanvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    ctx.save();
    ctx.translate(AppState.offset.x, AppState.offset.y);
    ctx.scale(AppState.scale, AppState.scale);
    
    const abilityState = abilitiesState();
    if (cursorPos) AppState.cursor = cursorPos;

    // Grid
    drawGrid(ctx, w, h, abilityState);
    
    // Background Image
    if (AppState.backgroundImage) {
        const img = AppState.backgroundImage;
        ctx.globalAlpha = 0.4;
        
        // Apply scale centered
        const scaledW = img.width * AppState.backgroundScale;
        const scaledH = img.height * AppState.backgroundScale;
        const imgX = -scaledW / 2;
        const imgY = -scaledH / 2;
        
        ctx.drawImage(img, imgX, imgY, scaledW, scaledH);
        ctx.globalAlpha = 1.0;
    }
    
    // Walls
    AppState.walls.forEach(wall => drawWall(ctx, wall.start, wall.end, false, wall.id === AppState.selectedWallId));
    
    // Wall Preview
    if (AppState.isDrawing && AppState.wallStart && cursorPos) {
        drawWall(ctx, AppState.wallStart, cursorPos, true);
    }
    
    // Fixtures
    AppState.fixtures.forEach(f => {
        if (f.visible === false && !abilityState.showHidden) return;
        drawFixture(ctx, f);
    });

    // Ghost Item Preview
    if (abilityState.ghostPreview !== false && cursorPos && !AppState.drag && AppState.currentTool && !['wall', 'delete', 'select'].includes(AppState.currentTool)) {
        ctx.globalAlpha = 0.5;
        // Mock fixture for drawing
        const ghost = { x: cursorPos.x, y: cursorPos.y, rotation: 0, type: AppState.currentTool, metadata: ItemFactory.create(AppState.currentTool,0,0).metadata };
        drawFixture(ctx, ghost);
        ctx.globalAlpha = 1.0;
    }

    // Ability overlays that belong to the plan plane.
    drawPlanOverlays(ctx, {
        walls: AppState.walls,
        fixtures: AppState.fixtures,
        selected: AppState.selectedFixture,
        selectedWallId: AppState.selectedWallId,
        state: abilityState,
        ruler: { ...(AppState.ruler || {}), cursor: AppState.cursor }
    });

    ctx.restore();

    // Viewport-fixed overlays (north, scale bar, HUD, legend, border).
    drawScreenOverlays(ctx, {
        walls: AppState.walls,
        fixtures: AppState.fixtures,
        selectedWallId: AppState.selectedWallId,
        state: abilityState,
        cursor: AppState.cursor,
        view: { width: w, height: h }
    });
}

function drawGrid(ctx, w, h, abilityState = {}) {
    if (abilityState.grid !== false) {
        const g = AppState.gridSize;
        // Large enough to cover the panned view at any zoom.
        const large = 5000;
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = -large; x <= large; x += g) {
            ctx.moveTo(x, -large);
            ctx.lineTo(x, large);
        }
        for (let y = -large; y <= large; y += g) {
            ctx.moveTo(-large, y);
            ctx.lineTo(large, y);
        }
        ctx.stroke();
    }

    if (abilityState.axes !== false) {
        ctx.strokeStyle = '#9ca3af';
        ctx.beginPath();
        ctx.moveTo(-20, 0); ctx.lineTo(20, 0);
        ctx.moveTo(0, -20); ctx.lineTo(0, 20);
        ctx.stroke();
    }
}

function drawWall(ctx, start, end, isPreview = false, isSelected = false) {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.lineWidth = isSelected ? 9 : 6;
    ctx.strokeStyle = isPreview ? '#9ca3af' : (isSelected ? '#f59e0b' : '#2563eb');
    if (isPreview) ctx.setLineDash([10, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Endpoints
    ctx.fillStyle = isPreview ? '#9ca3af' : (isSelected ? '#b45309' : '#1e40af');
    ctx.beginPath(); ctx.arc(start.x, start.y, 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(end.x, end.y, 4, 0, Math.PI*2); ctx.fill();
    
    // Dimensions
    if (AppState.showDimensions) {
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        const len = Math.hypot(end.x - start.x, end.y - start.y);
        const text = (len / SCALE).toFixed(1) + 'm';
        
        ctx.save();
        ctx.font = 'bold 11px "Space Grotesk", sans-serif';
        const tm = ctx.measureText(text);
        
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(midX - tm.width/2 - 4, midY - 8, tm.width + 8, 16);
        
        ctx.fillStyle = '#111827';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, midX, midY);
        ctx.restore();
    }
}

function drawFixture(ctx, f) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rotation);
    
    const { width, depth } = itemDimensions(f);
    const w = width * SCALE;
    const d = depth * SCALE;
    
    const isSelected = AppState.selectedFixture && AppState.selectedFixture.id === f.id;
    const isHidden = f.visible === false;

    if (isHidden) {
        // Draw hidden pieces as a dashed outline so they can still be found and
        // brought back, without pretending to be part of the plan.
        ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-w / 2, -d / 2, w, d);
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.restore();
        return;
    }

    const metaColor = f.metadata?.color != null
        ? '#' + f.metadata.color.toString(16).padStart(6, '0')
        : null;
    ctx.fillStyle = f.type === 'window' ? '#93c5fd' : (f.type === 'door' ? '#b45309' : (metaColor || '#64748b'));
    ctx.strokeStyle = isSelected ? '#f59e0b' : '#334155';
    ctx.lineWidth = isSelected ? 3 : 1;

    ctx.beginPath();
    ctx.rect(-w/2, -d/2, w, d);
    ctx.fill();
    ctx.stroke();
    
    // Orientation line
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w/2, 0);
    ctx.stroke();
    
    ctx.restore();
}

// ------------------------------------------------------------------
// 3D Logic
// ------------------------------------------------------------------

function init3D() {
    const container = document.getElementById('render-3d-view');
    const w = container.clientWidth;
    const h = container.clientHeight;
    
    scene3D = new THREE.Scene();
    scene3D.background = new THREE.Color(0xf3f4f6);
    
    camera3D = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
    camera3D.position.set(10, 10, 10);
    
    // Side elevation camera: orthographic, head-on to one of the four sides.
    orthoCamera3D = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 200);
    orthoCamera3D.position.set(0, 1.35, 20);

    renderer3D = new THREE.WebGLRenderer({ antialias: true });
    renderer3D.setSize(w, h);
    renderer3D.shadowMap.enabled = true;
    container.appendChild(renderer3D.domElement);
    
    controls3D = new OrbitControls(camera3D, renderer3D.domElement);
    controls3D.enableDamping = true;

    // Elevation controls keep the drawing head-on: no orbit, pan and zoom only.
    orthoControls3D = new OrbitControls(orthoCamera3D, renderer3D.domElement);
    orthoControls3D.enableDamping = true;
    orthoControls3D.enableRotate = false;
    orthoControls3D.enabled = false;
    
    // Lights
    const amb = new THREE.AmbientLight(0xffffff, 0.5);
    scene3D.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    dir.castShadow = true;
    scene3D.add(dir);
    
    conversionEngine = new ConversionEngine3D(scene3D);

    initGizmo();

    // Up/down and side-to-side dragging inside an elevation view.
    elevationDrag = createElevationDrag({
        scene: scene3D,
        domElement: renderer3D.domElement,
        getCamera: activeCamera,
        getSide: () => AppState.elevationSide,
        getView: () => ({ width: blueprintCanvas.width, height: blueprintCanvas.height }),
        getFixtures: () => AppState.fixtures,
        getObject: findItemObject,
        onDraggingChange: (active) => {
            if (orthoControls3D) orthoControls3D.enabled = Boolean(AppState.elevationSide) && !active;
        },
        onCommit: () => {
            // The mesh was moved live; rebuild so the 2D plan and storage agree
            // (and so snapping is baked into the saved position).
            saveAndSync();
            refreshGizmo();
        }
    });

    // Picking in the 3D view: click selects, drag orbits.
    let pointerDownAt = null;
    renderer3D.domElement.addEventListener('pointerdown', (e) => {
        pointerDownAt = { x: e.clientX, y: e.clientY, button: e.button };
    });
    renderer3D.domElement.addEventListener('pointerup', (e) => {
        const start = pointerDownAt;
        pointerDownAt = null;
        if (!start || start.button !== 0 || e.button !== 0) return;
        // A press that grabbed a gizmo handle or dragged a piece belongs to the
        // gizmo / elevation drag, not to selection
        if (elevationDrag && elevationDrag.dragging) return;
        if (itemGizmo && (itemGizmo.dragging || itemGizmo.controls.axis)) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return; // orbit, not a click
        selectItemAtPointer(e);
    });
    
    // Ability helpers: the 3D grid and axes are ability toggles themselves.
    gridHelper3D = new THREE.GridHelper(20, 20, 0x888888, 0xcccccc);
    gridHelper3D.visible = Boolean(abilitiesState().grid3D);
    scene3D.add(gridHelper3D);

    axesHelper3D = new THREE.AxesHelper(5);
    axesHelper3D.visible = Boolean(abilitiesState().axes3D);
    scene3D.add(axesHelper3D);

    animate3D();
}

function initGizmo() {
    if (itemGizmo || !scene3D) return;
    itemGizmo = createItemGizmo({
        scene: scene3D,
        camera: camera3D,
        renderer: renderer3D,
        orbit: controls3D,
        onPreview: (object) => {
            const fixture = AppState.selectedFixture;
            if (!fixture) return;
            // The gizmo moves the mesh; mirror it back into plan coordinates
            // so the 2D canvas follows while the handle is still held.
            const plan = planFromObject(object, blueprintCanvas);
            fixture.x = plan.x;
            fixture.y = plan.y;
            fixture.rotation = plan.rotation;

            // A Y drag becomes the item's lift, measured from the height the
            // mesh had when the gizmo attached (its builder default).
            if (AppState.gizmoBase) {
                const delta = object.position.y - AppState.gizmoBase.y;
                fixture.elevation = Math.max(-0.9, AppState.gizmoBase.elevation + delta);
            }

            draw2D();
        },
        onCommit: () => {
            const fixture = AppState.selectedFixture;
            if (!fixture) return;
            snapToWalls(fixture, AppState.walls, { threshold: 24 / AppState.scale });
            saveAndSync();
        }
    });
    itemGizmo.setMode(gizmoMode);
}

function findItemObject(id) {
    let found = null;
    if (!scene3D) return null;
    scene3D.traverse((child) => {
        if (!found && child.userData && child.userData.type === 'item' && child.userData.id === id) found = child;
    });
    return found;
}

function refreshGizmo() {
    if (!itemGizmo) return;
    const fixture = AppState.selectedFixture;
    if (!fixture || fixture.locked || fixture.visible === false || AppState.viewMode !== '3d' || AppState.elevationSide) {
        itemGizmo.detach();
        AppState.gizmoBase = null;
        return;
    }
    const object = findItemObject(fixture.id);
    if (object) {
        itemGizmo.attach(object);
        // Remember the mesh's builder height so Y movement maps to elevation.
        AppState.gizmoBase = { y: object.position.y, elevation: fixture.elevation || 0 };
    } else {
        itemGizmo.detach();
        AppState.gizmoBase = null;
    }
}

function selectItemAtPointer(event) {
    if (!scene3D || !renderer3D) return;
    const id = pickItemId(scene3D, activeCamera(), renderer3D.domElement, event);
    AppState.selectedFixture = id ? AppState.fixtures.find((f) => f.id === id) || null : null;
    if (AppState.selectedFixture) AppState.selectedWallId = null;
    if (AppState.selectedFixture) AppState.currentTool = 'select';
    draw2D();
    refreshGizmo();
    syncSelectionPanels();
}

function setGizmoMode(mode) {
    gizmoMode = mode === 'rotate' ? 'rotate' : 'translate';
    if (itemGizmo) itemGizmo.setMode(gizmoMode);
}

function activeCamera() {
    return AppState.elevationSide && orthoCamera3D ? orthoCamera3D : camera3D;
}

/** World-space (metres) footprint of the plan, used to frame the elevations. */
function worldBounds() {
    const view = { width: blueprintCanvas?.width || 1, height: blueprintCanvas?.height || 1 };
    const points = [];
    (AppState.walls || []).forEach((wall) => {
        if (wall.start) points.push(wall.start);
        if (wall.end) points.push(wall.end);
    });
    if (points.length === 0) {
        (AppState.fixtures || []).forEach((fixture) => points.push({ x: fixture.x, y: fixture.y }));
    }
    if (points.length === 0) return { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    points.forEach((point) => {
        const x = (point.x - view.width / 2) / PIXELS_PER_METER;
        const z = (point.y - view.height / 2) / PIXELS_PER_METER;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    });
    return { minX, maxX, minZ, maxZ };
}

function updateElevationCamera() {
    if (!AppState.elevationSide || !orthoCamera3D) return;
    const container = document.getElementById('render-3d-view');
    const width = container?.clientWidth || 1;
    const height = container?.clientHeight || 1;

    elevationBounds = worldBounds();
    const target = frameElevation(orthoCamera3D, {
        bounds: elevationBounds,
        side: AppState.elevationSide,
        aspect: width / height
    });
    if (target && orthoControls3D) {
        orthoControls3D.target.copy(target);
        orthoControls3D.update();
    }
    applyElevationVisibility(scene3D, AppState.elevationSide, elevationBounds);
}

/**
 * Switch the 3D preview between the orbit view and one of the four side
 * elevations (front/back/left/right). Passing null goes back to the orbit.
 */
function setElevationView(side) {
    const nextSide = side && ELEVATION_SIDES.includes(side) ? side : null;
    AppState.elevationSide = nextSide;
    setViewMode(nextSide ? 'elevation' : '3d');
    if (nextSide) updateElevationCamera();
    updateElevationButtons();
}

/**
 * The single view switch: 2D plan, 3D orbit, or a head-on elevation.
 * Elevation is the 3D canvas with a side camera, so all three modes share the
 * same scene, the same selection state and their own drag handler.
 */
function setViewMode(mode) {
    const next = ['2d', '3d', 'elevation'].includes(mode) ? mode : '2d';
    const v2d = document.getElementById('view-2d');
    const v3d = document.getElementById('view-3d');
    const r3d = document.getElementById('render-3d-view');
    if (!v2d || !v3d) return;

    AppState.viewMode = next === '2d' ? '2d' : '3d';
    if (next === 'elevation') {
        AppState.elevationSide = AppState.elevationSide || 'front';
    } else {
        AppState.elevationSide = null;
    }

    const show3d = next !== '2d';
    v2d.style.opacity = show3d ? '0' : '1';
    v2d.style.pointerEvents = show3d ? 'none' : 'auto';
    v3d.style.opacity = show3d ? '1' : '0';
    v3d.style.pointerEvents = show3d ? 'auto' : 'none';
    if (r3d) r3d.style.display = show3d ? 'block' : 'none';

    if (itemGizmo) itemGizmo.detach();
    if (!show3d && elevationDrag) elevationDrag.end();

    if (show3d) update3D();
    if (AppState.elevationSide) updateElevationCamera();
    else if (scene3D) applyElevationVisibility(scene3D, null);

    if (controls3D) controls3D.enabled = !AppState.elevationSide;
    if (orthoControls3D) {
        orthoControls3D.enabled = Boolean(AppState.elevationSide) && !(elevationDrag && elevationDrag.dragging);
    }

    refreshGizmo();
    updateViewButtons();
}

function updateViewButtons() {
    document.querySelectorAll('[data-view-mode]').forEach((btn) => {
        const mode = btn.dataset.viewMode;
        const active = mode === 'elevation'
            ? Boolean(AppState.elevationSide)
            : mode === '3d'
                ? AppState.viewMode === '3d' && !AppState.elevationSide
                : AppState.viewMode === '2d';
        btn.classList.toggle('bg-primary', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('font-bold', active);
    });

    const bar = document.getElementById('elevation-bar');
    if (bar) bar.classList.toggle('hidden', !AppState.elevationSide);

    updateElevationButtons();
}

function updateElevationButtons() {
    document.querySelectorAll('.elevation-btn').forEach((btn) => {
        const isActive = (btn.dataset.side || '') === (AppState.elevationSide || '');
        btn.classList.toggle('bg-primary', isActive);
        btn.classList.toggle('font-bold', isActive);
    });
    const hint = document.getElementById('elevation-hint');
    if (hint) {
        hint.textContent = AppState.elevationSide
            ? 'Elevation • drag a piece up/down or side to side — it snaps to the run'
            : 'Click an object to select • G move • R rotate • Elevation for up/down';
    }
}

function update3D() {
    if (!conversionEngine) return;
    // The rebuild replaces the meshes, so drop the old gizmo target first.
    if (itemGizmo) itemGizmo.detach();

    // The 3D preview is built from the same graph the 2D canvas edits, so wall
    // ids, shared corners and the metre labels line up between both views.
    const view = { width: blueprintCanvas.width, height: blueprintCanvas.height };
    const graph = graphFromWalls(AppState.walls, view, { snapPixels: 2 });
    AppState.graph = graph;
    const walls = graph.toCanvasWalls(view);

    const engineState = {
        stories: [{
            walls,
            fixtures: AppState.fixtures,
            height: WALL_HEIGHT
        }],
        currentStoryIndex: 0,
        measurements: measurePlan(graph),
        showMeasurements: AppState.showDimensions,
        fixtureStyles: AppState.fixtureStyles,
        showCeiling: AppState.showCeiling,
        showRoof: AppState.showRoof,
        defaultWallTexture: AppState.defaultWallTexture,
        defaultFloorTexture: AppState.defaultFloorTexture
    };
    
    // Pass canvas dimensions to center the model correctly
    // conversionEngine calculates: (x - width/2) / SCALE
    // So by passing blueprintCanvas.width, we align logical center to 3D origin
    conversionEngine.convert(engineState, blueprintCanvas.width, blueprintCanvas.height);

    // Frame the first non-empty plan, then leave the camera to the user.
    if (!AppState.hasFramed3D && graph.edges.length > 0 && camera3D && controls3D) {
        fitCameraToGraph(camera3D, controls3D, graph, { targetHeight: WALL_HEIGHT * 0.45 });
        AppState.hasFramed3D = true;
    }
    if (graph.edges.length === 0) AppState.hasFramed3D = false;

    // Ability flags (wireframe, hidden walls, grid/axes, shadows) survive the
    // rebuild, so they are re-applied to the new meshes here.
    apply3DAbilities(
        { scene: scene3D, renderer: renderer3D, controls: AppState.elevationSide ? orthoControls3D : controls3D },
        abilitiesState(),
        { grid: gridHelper3D, axes: axesHelper3D }
    );

    // The rebuild replaces every wall mesh, so the elevation cut has to be
    // re-applied to the new ones.
    if (AppState.elevationSide) {
        elevationBounds = worldBounds();
        applyElevationVisibility(scene3D, AppState.elevationSide, elevationBounds);
    } else {
        applyElevationVisibility(scene3D, null);
    }

    refreshGizmo();
}

function animate3D() {
    requestAnimationFrame(animate3D);
    const controls = AppState.elevationSide ? orthoControls3D : controls3D;
    if (controls) controls.update();
    if (AppState.viewMode === '3d') {
        renderer3D.render(scene3D, activeCamera());
    }
}

// ------------------------------------------------------------------
// Interaction & UI
// ------------------------------------------------------------------

function setupEventListeners() {
    // Canvas events
    blueprintCanvas.addEventListener('pointerdown', onPointerDown);
    blueprintCanvas.addEventListener('pointermove', onPointerMove);
    blueprintCanvas.addEventListener('pointerup', onPointerUp);
    blueprintCanvas.addEventListener('wheel', onWheel);
    blueprintCanvas.addEventListener('dblclick', onDoubleClick);
    
    // Context menu disable
    blueprintCanvas.addEventListener('contextmenu', e => e.preventDefault());
    
    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return; // Ignore if typing

        // Ctrl/Cmd+D duplicates the selection (before the D delete-tool shortcut).
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            duplicateSelected();
            return;
        }

        switch(e.key.toLowerCase()) {
            case 'w': setTool('wall'); setActiveToolBtn('wall'); break;
            case 'd': setTool('delete'); setActiveToolBtn('delete'); break;
            case 'escape': 
                setTool('select'); 
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active', 'border-primary', 'bg-blue-50', 'text-primary'));
                refreshGizmo();
                break;
            case 'g': setGizmoMode('translate'); break;
            case 'r': setGizmoMode('rotate'); break;
            case 'l': window.toggleSelectedLock(); break;
            case 'h': window.toggleSelectedVisibility(); break;
            case '1': setViewMode('2d'); break;
            case '2': setViewMode('3d'); break;
            case '3': setViewMode('elevation'); break;
            case 'z':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    if (e.shiftKey) stateManager.redo();
                    else stateManager.undo();
                    updateUI();
                }
                break;
        }
    });

    // Window Resize
    window.addEventListener('resize', onResize);
    
    // Tools
    document.querySelectorAll('.tool-btn').forEach(btn => {
        if (btn.dataset.tool) { // Skip non-tool buttons like Clear
            btn.addEventListener('click', () => {
                setTool(btn.dataset.tool);
                setActiveBtn(btn, '.tool-btn');
            });
        }
    });
    
    // Merlot cabinetry dropdown
    const merlotSelect = document.getElementById('merlot-select');
    if (merlotSelect) {
        merlotSelect.addEventListener('change', () => {
            if (!merlotSelect.value) return;
            setTool(merlotSelect.value);
        });
    }

    // Elevation view buttons (3D | Front | Back | Left | Right)
    document.querySelectorAll('.elevation-btn').forEach((btn) => {
        btn.addEventListener('click', () => setElevationView(btn.dataset.side || null));
    });
    updateElevationButtons();

    // Shaker cabinetry dropdown
    const shakerSelect = document.getElementById('shaker-select');
    if (shakerSelect) {
        shakerSelect.addEventListener('change', () => {
            if (!shakerSelect.value) return;
            setTool(shakerSelect.value);
        });
    }

    // Items
    document.querySelectorAll('.item-button').forEach(btn => {
        btn.addEventListener('click', () => {
            setTool(btn.dataset.item);
            // Visual feedback handled by CSS active states if needed
        });
    });
    
    // File Upload handling moved to wireUploadModal
}

function wireUploadModal() {
    const modal = document.getElementById('upload-modal');
    const fileInput = document.getElementById('hidden-file-input');
    const btnImage = document.getElementById('upload-image-btn');
    const btnJson = document.getElementById('upload-json-btn');
    const btnAi = document.getElementById('upload-ai-btn');
    
    if (!modal || !fileInput) return;

    let uploadMode = 'image'; // image | json | ai

    const triggerUpload = (mode, accept) => {
        uploadMode = mode;
        fileInput.accept = accept;
        fileInput.click();
    };

    btnImage?.addEventListener('click', () => triggerUpload('image', 'image/*'));
    btnJson?.addEventListener('click', () => triggerUpload('json', '.json'));
    btnAi?.addEventListener('click', () => triggerUpload('ai', 'image/*'));

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        modal.classList.add('hidden');

        if (uploadMode === 'json') {
            try {
                const data = await StorageManager.importProject(file);
                restoreState(data);
                alert('Project loaded successfully');
            } catch(err) { 
                console.error(err);
                alert('Failed to load project file'); 
            }
        } else if (uploadMode === 'image') {
            const reader = new FileReader();
            reader.onload = (evt) => {
                const img = new Image();
                img.onload = () => {
                    AppState.backgroundImage = img;
                    AppState.backgroundScale = 1.0;
                    draw2D();
                };
                img.src = evt.target.result;
            };
            reader.readAsDataURL(file);
        } else if (uploadMode === 'ai') {
            // AI Processing
            const toast = document.createElement('div');
            toast.className = 'fixed bottom-4 right-4 bg-purple-600 text-white px-6 py-3 rounded-lg shadow-xl z-50 flex items-center gap-3';
            toast.innerHTML = '<span class="animate-spin">⏳</span> Processing Floorplan...';
            document.body.appendChild(toast);

            try {
                const processor = new FloorPlanProcessor();
                const result = await processor.processImage(file);
                
                if (result && result.walls) {
                    // Set as background first for reference
                    const img = new Image();
                    img.onload = () => {
                        AppState.backgroundImage = img;
                        
                        // Scale walls to fit canvas reasonable size (approx 20m width)
                        // This logic centers and scales the result to match the editor's coordinate system
                        const targetWidth = 20 * SCALE; // 20 meters
                        const scanScale = targetWidth / result.width;
                        AppState.backgroundScale = scanScale;

                        // Center offset
                        const offsetX = (result.width * scanScale) / 2;
                        const offsetY = (result.height * scanScale) / 2;

                        AppState.walls = [];
                        result.walls.forEach(contour => {
                            for(let i=1; i<contour.length; i++) {
                                const p1 = contour[i-1];
                                const p2 = contour[i];
                                AppState.walls.push(new Wall(
                                    p1[0] * scanScale - offsetX, 
                                    p1[1] * scanScale - offsetY, 
                                    p2[0] * scanScale - offsetX, 
                                    p2[1] * scanScale - offsetY
                                ));
                            }
                        });

                        toast.remove();
                        saveAndSync();
                        alert(`AI Scan Complete: ${AppState.walls.length} walls detected.`);
                    };
                    img.src = URL.createObjectURL(file);
                }
            } catch (err) {
                console.error(err);
                toast.remove();
                alert('AI processing failed. Try manual tracing mode.');
            }
        }
        
        // Reset input
        fileInput.value = '';
    });
}

function setTool(tool) {
    AppState.currentTool = tool;
    AppState.drag = null;
    AppState.selectedFixture = null;
    refreshGizmo();
    console.log('Tool set to:', tool);
}

function setActiveBtn(btn, selector) {
    document.querySelectorAll(selector).forEach(b => b.classList.remove('active', 'border-primary', 'bg-blue-50', 'text-primary'));
    btn.classList.add('active', 'border-primary', 'bg-blue-50', 'text-primary');
}

function setActiveToolBtn(toolName) {
    const btn = document.querySelector(`.tool-btn[data-tool="${toolName}"]`);
    if (btn) setActiveBtn(btn, '.tool-btn');
}

function onResize() {
    const parent = blueprintCanvas.parentElement;
    blueprintCanvas.width = parent.clientWidth;
    blueprintCanvas.height = parent.clientHeight;
    draw2D();
    
    const container3D = document.getElementById('render-3d-view');
    if (renderer3D && container3D) {
        renderer3D.setSize(container3D.clientWidth, container3D.clientHeight);
        camera3D.aspect = container3D.clientWidth / container3D.clientHeight;
        camera3D.updateProjectionMatrix();
        // The ortho frustum is derived from the viewport, so it has to be
        // reframed whenever the size changes.
        if (AppState.elevationSide) updateElevationCamera();
    }
}

/** Backwards-compatible flip between the plan and the 3D orbit view. */
function toggleView() {
    setViewMode(AppState.viewMode === '2d' ? '3d' : '2d');
}

function restoreState(data) {
    if (data.walls) AppState.walls = data.walls.map(w => Wall.fromJSON(w));
    if (data.fixtures) AppState.fixtures = data.fixtures.map(f => ItemFactory.fromJSON(f));
    if (data.fixtureStyles) AppState.fixtureStyles = data.fixtureStyles;
    
    stateManager.saveState(); // Reset history with new state
    draw2D();
    update3D();
}

function updateUI() {
    draw2D();
    update3D();
    saveToStorage();
}

let dragUpdateTimer = null;

/** Rebuild the 3D preview while dragging, throttled so CSG does not run per pixel. */
function scheduleDragUpdate() {
    if (dragUpdateTimer) return;
    dragUpdateTimer = setTimeout(() => {
        dragUpdateTimer = null;
        update3D();
    }, 60);
}

function saveAndSync() {
    stateManager.saveState();
    update3D();
    draw2D();
    syncSelectionPanels();
    saveToStorage();
}

function saveToStorage() {
    StorageManager.saveProject('autosave', {
        walls: AppState.walls,
        fixtures: AppState.fixtures,
        fixtureStyles: AppState.fixtureStyles
    });
}

function clearProject() {
    AppState.walls = [];
    AppState.fixtures = [];
    AppState.backgroundImage = null;
    AppState.fixtureStyles = {};
    saveAndSync();
}

function exportProject() {
    const data = {
        walls: AppState.walls,
        fixtures: AppState.fixtures
    };
    StorageManager.exportProject(data);
}

function export3D(format) {
    if (!scene3D) return;
    const exporter = format === 'gltf' ? new GLTFExporter() : new OBJExporter();
    exporter.parse(scene3D, (result) => {
        const blob = new Blob([format === 'gltf' ? JSON.stringify(result) : result], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `project.${format}`;
        a.click();
    });
}
