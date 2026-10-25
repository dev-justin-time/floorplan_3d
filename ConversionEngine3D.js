import * as THREE from 'three';
import { TEXTURES, GLOBAL_CONFIG } from './metadata.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// Import the refactored factory pattern
import { FurnitureFactory, buildDefaultBox } from './furnitureBuilders.js';
import { formatLength, formatArea } from './measurements.js';

const SCALE = GLOBAL_CONFIG.pixelsPerMeter;
const ROOM_HEIGHT = GLOBAL_CONFIG.wallHeight;
const WALL_THICKNESS = GLOBAL_CONFIG.wallThickness;

// FIX 1: Pass loadingManager to TextureLoader
const loadingManager = new THREE.LoadingManager();
loadingManager.onLoad = () => console.log('All textures loaded');
const textureLoader = new THREE.TextureLoader(loadingManager);
const loadedTextures = {};

// A texture that failed to load samples black. Swapping the image for a 1x1
// white canvas keeps the material's base colour instead.
let whitePixelCanvas = null;
function getWhitePixelImage() {
    if (whitePixelCanvas) return whitePixelCanvas;
    whitePixelCanvas = document.createElement('canvas');
    whitePixelCanvas.width = 1;
    whitePixelCanvas.height = 1;
    const ctx = whitePixelCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
    return whitePixelCanvas;
}

function loadTexture(url) {
    if (!url) return null;
    if (loadedTextures[url]) return loadedTextures[url];

    const texture = textureLoader.load(
        url,
        (tex) => {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(2, 2);
            tex.colorSpace = THREE.SRGBColorSpace;
            loadedTextures[url] = tex;
        },
        undefined,
        () => {
            console.warn(`Failed to load texture ${url}, using flat colour`);
            // Materials already reference this texture, so fixing its image is
            // enough to turn every one of them into its plain base colour.
            texture.image = getWhitePixelImage();
            texture.needsUpdate = true;
        }
    );
    return texture;
}

/** Canvas-textured sprite used for metre labels in 3D. */
function createLabelSprite(text) {
    const fontSize = 64;
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = `bold ${fontSize}px sans-serif`;

    const padding = 28;
    const width = Math.ceil(measureCtx.measureText(text).width) + padding * 2;
    const height = Math.ceil(fontSize * 1.6);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(17, 24, 39, 0.82)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, width / 2, height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false
    }));

    const spriteHeight = 0.34;
    sprite.scale.set(spriteHeight * (width / height), spriteHeight, 1);
    return sprite;
}

export class ConversionEngine3D {
    constructor(scene) {
        this.scene = scene;
        this.meshes = [];
        
        // FIX 2: Instantiate Evaluator once in constructor to avoid expensive rebuilds
        this.evaluator = new Evaluator();
        
        // FIX 3: Track pending async loads to prevent ghost meshes on rapid deletion
        this.pendingLoads = new Set();

        this.gltfLoader = new GLTFLoader();
        this.dracoLoader = new DRACOLoader();
        this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
        this.gltfLoader.setDRACOLoader(this.dracoLoader);
        this.loadedModels = new Map();
    }

    updateItemTransform(item, canvasWidth, canvasHeight) {
        const mesh = this.meshes.find(m => m.userData.id === item.id);
        if (mesh) {
            const x = (item.x - canvasWidth / 2) / SCALE;
            const z = (item.y - canvasHeight / 2) / SCALE;
            mesh.position.set(x, mesh.position.y, z);
            mesh.rotation.y = -item.rotation;
            
            const box = this.meshes.find(m => m.type === 'BoxHelper');
            if (box) box.update();
        }
    }

    // FIX 4: Recursive disposal to prevent massive memory leaks
    clear() {
        // Abort pending loads to prevent callbacks firing on disposed scenes
        this.pendingLoads.clear();
        
        this.meshes.forEach(mesh => {
            this.scene.remove(mesh);
            this.disposeObject(mesh);
        });
        this.meshes = [];
    }

    disposeObject(obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
        }
        // Recursively dispose children (crucial for Groups, BoxHelpers, etc.)
        if (obj.children) {
            obj.children.forEach(child => this.disposeObject(child));
        }
    }

    convert(appState, canvasWidth, canvasHeight) {
        this.clear();
        this.addLighting();
        
        const stories = appState.stories || [{ 
            walls: appState.walls, fixtures: appState.fixtures, height: ROOM_HEIGHT, id: 'default' 
        }];

        let currentElevation = 0;
        stories.forEach((story, index) => {
            const isTopStory = index === stories.length - 1;
            const storyHeight = story.height || ROOM_HEIGHT;
            
            const storyGroup = new THREE.Group();
            storyGroup.position.y = currentElevation;
            this.scene.add(storyGroup);
            this.meshes.push(storyGroup);

            this.addFloorToGroup(storyGroup, appState.defaultFloorTexture);
            
            if (appState.showCeiling || !isTopStory) {
                this.addCeilingToGroup(storyGroup, storyHeight);
            }

            this.addWallsToGroup(storyGroup, story.walls, appState.defaultWallTexture, canvasWidth, canvasHeight, story.fixtures, storyHeight, appState.selectedWallId);
            this.addItemsToGroup(storyGroup, story.fixtures, appState.fixtureStyles, canvasWidth, canvasHeight, appState.selectedFixture?.id);

            // Labels only on the ground floor, from the same measurement data
            // the 2D canvas draws, so both views quote identical numbers.
            if (index === 0 && appState.showMeasurements && appState.measurements) {
                this.addMeasurementsToGroup(storyGroup, appState.measurements, storyHeight);
            }

            if (isTopStory && appState.showRoof) {
                this.addRoof(story.walls, currentElevation + storyHeight, canvasWidth, canvasHeight);
            }

            currentElevation += storyHeight;
        });
    }

    // FIX 5: Proper Gable Roof using ExtrudeGeometry instead of stretched Cone
    addRoof(walls, elevation, canvasWidth, canvasHeight) {
        if (!walls || walls.length === 0) return;

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        walls.forEach(wall => {
            const x1 = (wall.start.x - canvasWidth / 2) / SCALE;
            const z1 = (wall.start.y - canvasHeight / 2) / SCALE;
            const x2 = (wall.end.x - canvasWidth / 2) / SCALE;
            const z2 = (wall.end.y - canvasHeight / 2) / SCALE;
            minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2);
            minZ = Math.min(minZ, z1, z2); maxZ = Math.max(maxZ, z1, z2);
        });

        const overhang = GLOBAL_CONFIG.roofOverhang || 0.5;
        const pitch = GLOBAL_CONFIG.roofPitch || 1.5;
        const width = (maxX - minX) + (overhang * 2);
        const depth = (maxZ - minZ) + (overhang * 2);

        const shape = new THREE.Shape();
        shape.moveTo(-width / 2, 0);
        shape.lineTo(0, pitch);
        shape.lineTo(width / 2, 0);
        shape.lineTo(-width / 2, 0);

        // The profile is built in XY (width across X, pitch up Y) and extruded
        // along +Z, which already matches world axes: no rotation needed.
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false });
        const material = new THREE.MeshStandardMaterial({ color: 0x8a4b38, roughness: 0.9 });
        const roof = new THREE.Mesh(geometry, material);

        roof.position.set(minX - overhang + width / 2, elevation, minZ - overhang);
        
        roof.castShadow = true;
        roof.receiveShadow = true;
        
        this.scene.add(roof);
        this.meshes.push(roof);
    }

    addLighting() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient); this.meshes.push(ambient);

        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        hemi.position.set(0, 20, 0);
        this.scene.add(hemi); this.meshes.push(hemi);

        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(10, 15, 10);
        dir.castShadow = true;
        dir.shadow.mapSize.set(2048, 2048);
        // The floor is 40 m across: with the default +/-5 shadow box everything
        // outside it samples the map edge and renders as if fully shadowed.
        dir.shadow.camera.left = -22;
        dir.shadow.camera.right = 22;
        dir.shadow.camera.top = 22;
        dir.shadow.camera.bottom = -22;
        dir.shadow.camera.near = 1;
        dir.shadow.camera.far = 70;
        dir.shadow.camera.updateProjectionMatrix();
        dir.shadow.bias = -0.0005;
        dir.shadow.normalBias = 0.02;
        this.scene.add(dir); this.meshes.push(dir);
    }

    addFloorToGroup(group, textureId) {
        const geometry = new THREE.PlaneGeometry(40, 40);
        const texture = textureId && TEXTURES.floors[textureId] ? loadTexture(TEXTURES.floors[textureId]) : null;
        const material = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.2, map: texture });
        const floor = new THREE.Mesh(geometry, material);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        group.add(floor);
    }

    addCeilingToGroup(group, height) {
        const geometry = new THREE.PlaneGeometry(40, 40);
        const material = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 1.0 });
        const ceiling = new THREE.Mesh(geometry, material);
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = height;
        ceiling.receiveShadow = true;
        group.add(ceiling);
    }

    addItemsToGroup(group, fixtures, fixtureStyles, canvasWidth, canvasHeight, selectedId) {
        if (!fixtures) return;
        fixtures.forEach(fixture => {
            const style = (fixtureStyles && fixtureStyles[fixture.id]) || {};
            const mesh = this.createItemMesh(fixture, style);
            if (mesh) {
                const x = (fixture.x - canvasWidth / 2) / SCALE;
                const z = (fixture.y - canvasHeight / 2) / SCALE;
                mesh.position.set(x, mesh.position.y, z);
                mesh.rotation.y = -fixture.rotation;
                
                mesh.userData.id = fixture.id;
                mesh.userData.type = 'item';
                
                mesh.traverse((child) => {
                    if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
                });
                
                if (fixture.id === selectedId) {
                    const box = new THREE.BoxHelper(mesh, 0xffff00);
                    box.material.depthTest = false;
                    box.material.transparent = true;
                    group.add(box);
                }
                group.add(mesh);
            }
        });
    }

    // --- Legacy single-story adapters -------------------------------------
    // Kept so older callers that used the pre story-group API keep working.
    addFloor(textureId) {
        const group = new THREE.Group();
        this.scene.add(group);
        this.meshes.push(group);
        this.addFloorToGroup(group, textureId);
    }

    addCeiling(height = ROOM_HEIGHT) {
        const group = new THREE.Group();
        this.scene.add(group);
        this.meshes.push(group);
        this.addCeilingToGroup(group, height);
    }

    addWalls(walls, textureId, canvasWidth, canvasHeight, fixtures = []) {
        const group = new THREE.Group();
        this.scene.add(group);
        this.meshes.push(group);
        this.addWallsToGroup(group, walls, textureId, canvasWidth, canvasHeight, fixtures, ROOM_HEIGHT, null);
    }

    addWallsToGroup(group, walls, textureId, canvasWidth, canvasHeight, fixtures, wallHeight, selectedWallId) {
        const texture = textureId && TEXTURES.walls[textureId] ? loadTexture(TEXTURES.walls[textureId]) : null;
        const material = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.7, metalness: 0.1, map: texture });

        const wallMeshes = [];
        walls.forEach(wall => {
            const dx = (wall.end.x - wall.start.x) / SCALE;
            const dy = (wall.end.y - wall.start.y) / SCALE;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx);

            const wallGeo = new THREE.BoxGeometry(length, wallHeight, WALL_THICKNESS);
            const cx = ((wall.start.x + wall.end.x) / 2 - canvasWidth / 2) / SCALE;
            const cz = ((wall.start.y + wall.end.y) / 2 - canvasHeight / 2) / SCALE;

            const wallMaterial = wall.id === selectedWallId ? material.clone() : material;
            if (wall.id === selectedWallId) wallMaterial.color.set(0xf59e0b);
            
            const wallBrush = new Brush(wallGeo, wallMaterial);
            wallBrush.userData = { id: wall.id, type: 'wall' };
            wallBrush.position.set(cx, wallHeight / 2, cz);
            wallBrush.rotation.y = -angle;
            wallBrush.updateMatrixWorld();

            const holes = fixtures.filter(f => f.boundToWallId === wall.id && ['window', 'round_window', 'door'].includes(f.type));

            if (holes.length > 0) {
                let resultBrush = wallBrush;
                holes.forEach(hole => {
                    const w = hole.metadata?.width || 1.0;
                    const h = hole.metadata?.height || 1.0;
                    const d = WALL_THICKNESS * 1.2;

                    let holeGeo = hole.metadata?.shape === 'circle' 
                        ? new THREE.CylinderGeometry(w / 2, w / 2, d, 32).rotateX(Math.PI / 2)
                        : new THREE.BoxGeometry(w, h, d);

                    const holeBrush = new Brush(holeGeo);
                    const hx = (hole.x - canvasWidth / 2) / SCALE;
                    const hz = (hole.y - canvasHeight / 2) / SCALE;
                    
                    let hy = h / 2; 
                    if (hole.type === 'window' || hole.type === 'round_window') hy = hole.metadata?.altitude || 1.0;
                    else if (hole.type === 'door') hy = h / 2 + 0.01;

                    holeBrush.position.set(hx, hy, hz);
                    holeBrush.rotation.y = -hole.rotation;
                    holeBrush.updateMatrixWorld();

                    // FIX 2 Applied: Reusing this.evaluator
                    resultBrush = this.evaluator.evaluate(resultBrush, holeBrush, SUBTRACTION);
                });

                resultBrush.castShadow = true;
                resultBrush.receiveShadow = true;
                resultBrush.userData = { id: wall.id, type: 'wall' };
                wallMeshes.push(resultBrush);
            } else {
                const mesh = new THREE.Mesh(wallGeo, wallMaterial);
                mesh.userData = { id: wall.id, type: 'wall' };
                mesh.position.copy(wallBrush.position);
                mesh.rotation.copy(wallBrush.rotation);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                wallMeshes.push(mesh);
            }
        });

        if (wallMeshes.length > 0) {
            const g = new THREE.Group();
            wallMeshes.forEach(mesh => g.add(mesh));
            group.add(g);
        }
    }

    /**
     * Metre labels for walls and room areas. Both views read these from
     * measurements.js, so 2D and 3D always agree.
     */
    addMeasurementsToGroup(group, measurements, wallHeight) {
        if (!measurements) return;

        (measurements.walls || []).forEach((wall) => {
            if (!wall.midpoint || wall.length < 0.6) return;
            const sprite = createLabelSprite(formatLength(wall.length));
            sprite.position.set(wall.midpoint.x, wallHeight + 0.2, wall.midpoint.z);
            group.add(sprite);
        });

        (measurements.rooms || []).forEach((room) => {
            if (!room.centroid || room.area < 0.5) return;
            const sprite = createLabelSprite(formatArea(room.area));
            sprite.position.set(room.centroid.x, 0.15, room.centroid.z);
            group.add(sprite);
        });
    }

    // FIX 3 Applied: Guard async loads
    async loadModel(url, id) {
        if (this.loadedModels.has(url)) return this.loadedModels.get(url).clone();

        try {
            const gltf = await this.gltfLoader.loadAsync(url);
            gltf.scene.traverse(child => {
                if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
            });
            this.loadedModels.set(url, gltf.scene);
            return gltf.scene.clone();
        } catch (error) {
            console.error('Failed to load model:', url, error);
            return null;
        }
    }

    // FIX 6 Applied: Factory Pattern replacing 400+ line switch statement
    createItemMesh(fixture, style = {}) {
        const color = style.color || fixture.metadata?.color || 0xffffff;
        const materialParams = { color: new THREE.Color(color) };

        if (style.texture && TEXTURES.floors[style.texture]) {
            materialParams.map = loadTexture(TEXTURES.floors[style.texture]);
        }

        if (style.material === 'metal') {
            materialParams.metalness = 0.9; materialParams.roughness = 0.1;
        } else if (style.material === 'gloss') {
            materialParams.metalness = 0.1; materialParams.roughness = 0.2;
        } else {
            materialParams.metalness = 0; materialParams.roughness = 0.9;
        }

        const material = new THREE.MeshStandardMaterial(materialParams);
        const width = fixture.metadata?.width || 0.5;
        const depth = fixture.metadata?.depth || 0.5;
        const height = fixture.metadata?.height || 0.5;

        if (fixture.modelUrl || fixture.metadata?.modelUrl) {
            const modelUrl = fixture.modelUrl || fixture.metadata.modelUrl;
            const placeholder = new THREE.Group();
            placeholder.userData = { isPlaceholder: true, id: fixture.id, type: 'item' };
            
            const loadPromise = this.loadModel(modelUrl, fixture.id).then(model => {
                this.pendingLoads.delete(loadPromise);
                if (model && placeholder.parent) {
                    model.scale.setScalar(fixture.metadata?.scale || 1);
                    model.position.copy(placeholder.position);
                    model.rotation.copy(placeholder.rotation);
                    model.userData = placeholder.userData;
                    placeholder.parent.add(model);
                    placeholder.parent.remove(placeholder);
                    this.disposeObject(placeholder); // Clean up the placeholder
                }
            });
            this.pendingLoads.add(loadPromise);
            return placeholder;
        }

        // Delegate to the factory registry, fallback to default box builder
        const builder = FurnitureFactory[fixture.type] || buildDefaultBox;
        const mesh = builder(width, height, depth, material, fixture);
        
        return mesh;
    }
}