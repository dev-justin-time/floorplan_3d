import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { ConversionEngine3D } from './3dConversionEngine.js';
import { Wall, ItemFactory } from './items.js';
import { StateManager } from './state-manager.js';
import { StorageManager } from './storage.js';
import { FloorPlanProcessor } from './floorPlanProcessor.js';

// Application State
const AppState = {
    viewMode: '2d',
    currentTool: 'wall',
    isDrawing: false,
    wallStart: null,
    walls: [],
    fixtures: [],
    selectedFixture: null,
    
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
let conversionEngine;
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
    
    // Load Autosave
    const saved = StorageManager.loadProject('autosave');
    if (saved) {
        restoreState(saved);
        console.log('Restored from autosave');
    }

    // Initial Draw
    onResize();
    draw2D();
    
    // Expose Global API
    window.undo = () => { stateManager.undo(); updateUI(); };
    window.redo = () => { stateManager.redo(); updateUI(); };
    window.toggleView = toggleView;
    window.toggleDimensions = () => { AppState.showDimensions = !AppState.showDimensions; draw2D(); };
    window.toggleCeiling = () => { AppState.showCeiling = !AppState.showCeiling; update3D(); };
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

function getCanvasCoordinates(event) {
    const rect = blueprintCanvas.getBoundingClientRect();
    let x = (event.clientX - rect.left - AppState.offset.x) / AppState.scale;
    let y = (event.clientY - rect.top - AppState.offset.y) / AppState.scale;
    
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
    
    // Handle Tool Interaction
    if (AppState.currentTool === 'wall') {
        AppState.isDrawing = true;
        AppState.wallStart = pos;
    } else if (AppState.currentTool === 'delete') {
        deleteObjectAt(pos.x, pos.y);
    } else if (AppState.currentTool) {
        // Place item
        const item = ItemFactory.create(AppState.currentTool, pos.x, pos.y);
        
        // Basic snapping
        if (item.snapToWall) item.snapToWall(AppState.walls);
        
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

    if (AppState.isDrawing && AppState.currentTool === 'wall') {
        const end = getCanvasCoordinates(e);
        const start = AppState.wallStart;
        
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

function draw2D(cursorPos = null) {
    const ctx = blueprintCtx;
    if (!ctx) return;
    const w = blueprintCanvas.width;
    const h = blueprintCanvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    ctx.save();
    ctx.translate(AppState.offset.x, AppState.offset.y);
    ctx.scale(AppState.scale, AppState.scale);
    
    // Grid
    drawGrid(ctx, w, h);
    
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
    AppState.walls.forEach(wall => drawWall(ctx, wall.start, wall.end));
    
    // Wall Preview
    if (AppState.isDrawing && AppState.wallStart && cursorPos) {
        drawWall(ctx, AppState.wallStart, cursorPos, true);
    }
    
    // Fixtures
    AppState.fixtures.forEach(f => drawFixture(ctx, f));

    // Ghost Item Preview
    if (cursorPos && AppState.currentTool && AppState.currentTool !== 'wall' && AppState.currentTool !== 'delete') {
        ctx.globalAlpha = 0.5;
        // Mock fixture for drawing
        const ghost = { x: cursorPos.x, y: cursorPos.y, rotation: 0, type: AppState.currentTool, metadata: ItemFactory.create(AppState.currentTool,0,0).metadata };
        drawFixture(ctx, ghost);
        ctx.globalAlpha = 1.0;
    }
    
    ctx.restore();
}

function drawGrid(ctx, w, h) {
    const g = AppState.gridSize;
    // Calculate visible area to optimize drawing? 
    // For simplicity, just draw a large enough grid centered
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
    
    // Origin
    ctx.strokeStyle = '#9ca3af';
    ctx.beginPath();
    ctx.moveTo(-20, 0); ctx.lineTo(20, 0);
    ctx.moveTo(0, -20); ctx.lineTo(0, 20);
    ctx.stroke();
}

function drawWall(ctx, start, end, isPreview = false) {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.lineWidth = 6;
    ctx.strokeStyle = isPreview ? '#9ca3af' : '#2563eb';
    if (isPreview) ctx.setLineDash([10, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Endpoints
    ctx.fillStyle = isPreview ? '#9ca3af' : '#1e40af';
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
    
    const w = (f.metadata.width || 0.5) * SCALE;
    const d = (f.metadata.depth || 0.5) * SCALE;
    
    // Highlight if selected (todo)
    ctx.fillStyle = f.type === 'window' ? '#93c5fd' : (f.type === 'door' ? '#b45309' : '#64748b');
    ctx.strokeStyle = '#334155';
    
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
    
    renderer3D = new THREE.WebGLRenderer({ antialias: true });
    renderer3D.setSize(w, h);
    renderer3D.shadowMap.enabled = true;
    container.appendChild(renderer3D.domElement);
    
    controls3D = new OrbitControls(camera3D, renderer3D.domElement);
    controls3D.enableDamping = true;
    
    // Lights
    const amb = new THREE.AmbientLight(0xffffff, 0.5);
    scene3D.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    dir.castShadow = true;
    scene3D.add(dir);
    
    conversionEngine = new ConversionEngine3D(scene3D);
    
    animate3D();
}

function update3D() {
    if (!conversionEngine) return;
    
    const engineState = {
        stories: [{
            walls: AppState.walls,
            fixtures: AppState.fixtures,
            height: 2.7
        }],
        currentStoryIndex: 0,
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
}

function animate3D() {
    requestAnimationFrame(animate3D);
    controls3D.update();
    if (AppState.viewMode === '3d') {
        renderer3D.render(scene3D, camera3D);
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
    
    // Context menu disable
    blueprintCanvas.addEventListener('contextmenu', e => e.preventDefault());
    
    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return; // Ignore if typing
        
        switch(e.key.toLowerCase()) {
            case 'w': setTool('wall'); setActiveToolBtn('wall'); break;
            case 'd': setTool('delete'); setActiveToolBtn('delete'); break;
            case 'escape': 
                setTool('select'); 
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active', 'border-primary', 'bg-blue-50', 'text-primary'));
                break;
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
    }
}

function toggleView() {
    const toggle = document.getElementById('view-toggle');
    const v2d = document.getElementById('view-2d');
    const v3d = document.getElementById('view-3d');
    const r3d = document.getElementById('render-3d-view');
    
    if (toggle.checked) {
        AppState.viewMode = '3d';
        v2d.style.opacity = '0';
        v2d.style.pointerEvents = 'none';
        v3d.style.opacity = '1';
        v3d.style.pointerEvents = 'auto';
        r3d.style.display = 'block';
        update3D();
    } else {
        AppState.viewMode = '2d';
        v2d.style.opacity = '1';
        v2d.style.pointerEvents = 'auto';
        v3d.style.opacity = '0';
        v3d.style.pointerEvents = 'none';
        r3d.style.display = 'none';
    }
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

function saveAndSync() {
    stateManager.saveState();
    update3D();
    draw2D();
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
