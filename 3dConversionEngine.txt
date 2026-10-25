import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { TEXTURES, GLOBAL_CONFIG } from './metadata.js';
// Using external flag to avoid dependency duplication issues with import maps
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const SCALE = GLOBAL_CONFIG.pixelsPerMeter;
const ROOM_HEIGHT = GLOBAL_CONFIG.wallHeight;
const WALL_THICKNESS = GLOBAL_CONFIG.wallThickness;

const textureLoader = new THREE.TextureLoader();
const loadedTextures = {};

// Texture Loading Manager
const loadingManager = new THREE.LoadingManager();
loadingManager.onLoad = () => {
    console.log('All textures loaded');
};

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
        (err) => console.warn(`Failed to load texture ${url}`)
    );
    return texture;
}

export class ConversionEngine3D {
    constructor(scene) {
        this.scene = scene;
        this.meshes = [];
        
        // Initialize model loaders
        this.gltfLoader = new GLTFLoader();
        this.dracoLoader = new DRACOLoader();
        this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
        this.gltfLoader.setDRACOLoader(this.dracoLoader);
        this.loadedModels = new Map();
    }

    // Optimized update for dragging items without full rebuild
    updateItemTransform(item, canvasWidth, canvasHeight) {
        const mesh = this.meshes.find(m => m.userData.id === item.id);
        if (mesh) {
            const x = (item.x - canvasWidth / 2) / SCALE;
            const z = -(item.y - canvasHeight / 2) / SCALE;
            mesh.position.set(x, mesh.position.y, z);
            mesh.rotation.y = -item.rotation;
            
            // Also update highlight box if present
            const box = this.meshes.find(m => m.type === 'BoxHelper');
            if (box) box.update();
        }
    }

    clear() {
        this.meshes.forEach(mesh => {
            this.scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
                else mesh.material.dispose();
            }
        });
        this.meshes = [];
    }

    convert(appState, canvasWidth, canvasHeight) {
        this.clear();
        this.addLighting();
        
        // Handle Multi-story
        const stories = appState.stories || [{ 
            walls: appState.walls, 
            fixtures: appState.fixtures, 
            height: ROOM_HEIGHT,
            id: 'default' 
        }];

        let currentElevation = 0;

        stories.forEach((story, index) => {
            const isTopStory = index === stories.length - 1;
            const storyHeight = story.height || ROOM_HEIGHT;
            
            // Create a group for this story
            const storyGroup = new THREE.Group();
            storyGroup.position.y = currentElevation;
            this.scene.add(storyGroup);
            this.meshes.push(storyGroup);

            // Add floor for this story
            this.addFloorToGroup(storyGroup, appState.defaultFloorTexture);
            
            // Add Ceiling if enabled (and not roof) or if it's a lower floor
            if (appState.showCeiling || !isTopStory) {
                this.addCeilingToGroup(storyGroup, storyHeight);
            }

            // Add Walls & Fixtures
            this.addWallsToGroup(storyGroup, story.walls, appState.defaultWallTexture, canvasWidth, canvasHeight, story.fixtures, storyHeight);
            this.addItemsToGroup(storyGroup, story.fixtures, appState.fixtureStyles, canvasWidth, canvasHeight, appState.selectedFixture?.id);

            // Add Roof on top story if enabled
            if (isTopStory && appState.showRoof) {
                this.addRoof(story.walls, currentElevation + storyHeight, canvasWidth, canvasHeight);
            }

            currentElevation += storyHeight;
        });
    }

    addRoof(walls, elevation, canvasWidth, canvasHeight) {
        if (!walls || walls.length === 0) return;

        // Calculate Bounding Box of walls
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        
        walls.forEach(wall => {
            const x1 = (wall.start.x - canvasWidth / 2) / SCALE;
            const z1 = -(wall.start.y - canvasHeight / 2) / SCALE;
            const x2 = (wall.end.x - canvasWidth / 2) / SCALE;
            const z2 = -(wall.end.y - canvasHeight / 2) / SCALE;
            
            minX = Math.min(minX, x1, x2);
            maxX = Math.max(maxX, x1, x2);
            minZ = Math.min(minZ, z1, z2);
            maxZ = Math.max(maxZ, z1, z2);
        });

        const overhang = GLOBAL_CONFIG.roofOverhang || 0.5;
        const pitch = GLOBAL_CONFIG.roofPitch || 1.5;

        minX -= overhang; maxX += overhang;
        minZ -= overhang; maxZ += overhang;

        const width = maxX - minX;
        const depth = maxZ - minZ;
        const height = pitch;

        // Create Pyramid/Hip Roof
        const geometry = new THREE.ConeGeometry(1, height, 4);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x8a4b38, 
            roughness: 0.9,
            name: 'roof_material'
        });
        
        const roof = new THREE.Mesh(geometry, material);
        
        // Scale to fit bounds (Cone is radius 1, so diameter 2)
        // Rotate 45 deg so corners align with box corners if it was square, 
        // but we want sides to align with axes. 
        // Cone geometry default: corner points to +X. 
        // We rotate Y by PI/4 (45 deg).
        roof.rotation.y = Math.PI / 4;
        
        // The diagonal of the base square (size sqrt(2)) needs to match our width/depth
        // Actually simpler: Scale X and Z after rotation? No, rotate first.
        // Let's just use a shape extrusion or simpler geometry.
        
        // Alternative: Prism geometry manually
        const roofGeo = new THREE.BufferGeometry();
        const w2 = width/2;
        const d2 = depth/2;
        const h = height;
        
        // Vertices for a simple hip roof/pyramid
        // Base
        const vertices = [
            // Base
            -w2, 0, -d2,  w2, 0, -d2,
            -w2, 0, d2,   w2, 0, d2,
            // Top (Ridge or Point) - making it a pyramid for robustness
            0, h, 0
        ];
        
        // Indices
        const indices = [
            0, 2, 1,  1, 2, 3, // Base (if visible from inside)
            0, 1, 4, // Front
            1, 3, 4, // Right
            3, 2, 4, // Back
            2, 0, 4  // Left
        ];

        // Actually let's use a simple Cone for "Hipped" look, scaled
        // Reset geometry
        const pyramid = new THREE.ConeGeometry(1, 1, 4, 1, true); // Open ended bottom
        const mesh = new THREE.Mesh(pyramid, material);
        
        // Align pyramid sides to axes
        mesh.rotation.y = Math.PI / 4; 
        
        // Cone base radius is 1. Diagonal is 2.
        // Inner square side length is sqrt(2) = 1.414
        const baseSize = Math.sqrt(2);
        
        mesh.scale.set(width / baseSize, height, depth / baseSize);
        mesh.position.set(minX + width/2, elevation + height/2, minZ + depth/2);
        
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        this.scene.add(mesh);
        this.meshes.push(mesh);
    }

    addLighting() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);
        this.meshes.push(ambient);

        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        hemi.position.set(0, 20, 0);
        this.scene.add(hemi);
        this.meshes.push(hemi);

        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(10, 15, 10);
        dir.castShadow = true;
        dir.shadow.mapSize.set(2048, 2048);
        dir.shadow.bias = -0.0001;
        this.scene.add(dir);
        this.meshes.push(dir);
    }

    addFloorToGroup(group, textureId) {
        const geometry = new THREE.PlaneGeometry(40, 40);
        const texture = textureId && TEXTURES.floors[textureId] ? loadTexture(TEXTURES.floors[textureId]) : null;

        const material = new THREE.MeshStandardMaterial({ 
            color: 0xf5f5f5, 
            side: THREE.DoubleSide,
            roughness: 0.8, 
            metalness: 0.2,
            map: texture 
        });

        const floor = new THREE.Mesh(geometry, material);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0;
        floor.receiveShadow = true;
        group.add(floor);
    }

    addCeilingToGroup(group, height) {
        const geometry = new THREE.PlaneGeometry(40, 40);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, 
            side: THREE.DoubleSide,
            roughness: 1.0
        });

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
                // Position conversion
                const x = (fixture.x - canvasWidth / 2) / SCALE;
                const z = -(fixture.y - canvasHeight / 2) / SCALE;
                
                // Allow mesh to override its Y position (e.g. wall items) but apply X/Z
                const currentY = mesh.position.y;
                mesh.position.set(x, currentY, z);
                mesh.rotation.y = -fixture.rotation;
                
                // Metadata for interaction
                mesh.userData.id = fixture.id;
                mesh.userData.type = 'item';
                
                // Shadow properties
                mesh.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                
                // Highlight selection
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

    // Legacy adapter for single-story calls (if any)
    addFloor(textureId) { /* no-op or adapted */ }
    addCeiling() { /* no-op or adapted */ }

    addWallsToGroup(group, walls, textureId, canvasWidth, canvasHeight, fixtures, wallHeight) {
        const texture = textureId && TEXTURES.walls[textureId] ? loadTexture(TEXTURES.walls[textureId]) : null;
        const material = new THREE.MeshStandardMaterial({ 
            color: 0xe0e0e0,
            roughness: 0.7,
            metalness: 0.1,
            map: texture
        });

        const evaluator = new Evaluator();
        const wallMeshes = [];

        walls.forEach(wall => {
            const dx = (wall.end.x - wall.start.x) / SCALE;
            const dy = (wall.end.y - wall.start.y) / SCALE;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx);

            // 1. Create Wall Brush
            const wallGeo = new THREE.BoxGeometry(length, wallHeight, WALL_THICKNESS);
            const cx = ((wall.start.x + wall.end.x) / 2 - canvasWidth / 2) / SCALE;
            const cz = ((wall.start.y + wall.end.y) / 2 - canvasHeight / 2) / SCALE;

            const wallBrush = new Brush(wallGeo, material);
            wallBrush.position.set(cx, wallHeight / 2, -cz);
            wallBrush.rotation.y = -angle;
            wallBrush.updateMatrixWorld();

            // 2. Find intersecting holes (Windows/Doors) bound to this wall
            const holes = fixtures.filter(f => f.boundToWallId === wall.id && (f.type === 'window' || f.type === 'door'));

            if (holes.length > 0) {
                let resultBrush = wallBrush;

                holes.forEach(hole => {
                    const w = (hole.metadata.width || 1.0);
                    const h = (hole.metadata.height || 1.0);
                    const d = WALL_THICKNESS * 1.2; // Thicker than wall to ensure clean cut

                    let holeGeo;
                    if (hole.metadata.shape === 'circle') {
                        const radius = w / 2;
                        holeGeo = new THREE.CylinderGeometry(radius, radius, d, 32);
                        holeGeo.rotateX(Math.PI / 2);
                    } else {
                        holeGeo = new THREE.BoxGeometry(w, h, d);
                    }

                    const holeBrush = new Brush(holeGeo);
                    
                    const hx = (hole.x - canvasWidth / 2) / SCALE;
                    const hz = -(hole.y - canvasHeight / 2) / SCALE;
                    
                    // Hole altitude (doors at floor, windows higher)
                    let hy = h / 2; 
                    if (hole.type === 'window') {
                        hy = hole.metadata.altitude || 1.0;
                    } else if (hole.type === 'door') {
                         hy = h / 2 + 0.01; // Slightly up to avoid z-fighting at floor
                    }

                    holeBrush.position.set(hx, hy, hz);
                    holeBrush.rotation.y = -hole.rotation;
                    holeBrush.updateMatrixWorld();

                    resultBrush = evaluator.evaluate(resultBrush, holeBrush, SUBTRACTION);
                });

                resultBrush.castShadow = true;
                resultBrush.receiveShadow = true;
                wallMeshes.push(resultBrush);
            } else {
                // No holes, just add the primitive
                const mesh = new THREE.Mesh(wallGeo, material);
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

    // Redirect legacy addWalls to use new group-based logic if called directly
    addWalls(walls, textureId, canvasWidth, canvasHeight, fixtures = []) {
        // This would only be called by legacy code. The new convert() uses addWallsToGroup.
    }

    async loadModel(url, id) {
        if (this.loadedModels.has(url)) {
            return this.loadedModels.get(url).clone();
        }

        try {
            const gltf = await this.gltfLoader.loadAsync(url);
            gltf.scene.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            this.loadedModels.set(url, gltf.scene);
            return gltf.scene.clone();
        } catch (error) {
            console.error('Failed to load model:', url, error);
            return null;
        }
    }

    createItemMesh(fixture, style = {}) {
        const color = style.color || fixture.metadata.color || 0xffffff;
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
        const width = fixture.metadata.width || 0.5;
        const depth = fixture.metadata.depth || 0.5;
        const height = fixture.metadata.height || 0.5;

        let geometry, mesh;
        
        // Check if fixture has a custom 3D model URL
        if (fixture.modelUrl || fixture.metadata.modelUrl) {
            const modelUrl = fixture.modelUrl || fixture.metadata.modelUrl;
            
            // Create placeholder while loading
            const placeholder = new THREE.Group();
            placeholder.userData = { isPlaceholder: true };
            
            // Load model asynchronously
            this.loadModel(modelUrl, fixture.id).then(model => {
                if (model) {
                    // Replace placeholder with actual model
                    model.scale.setScalar(fixture.metadata.scale || 1);
                    model.position.copy(placeholder.position);
                    model.rotation.copy(placeholder.rotation);
                    model.userData = placeholder.userData;
                    
                    if (placeholder.parent) {
                        placeholder.parent.add(model);
                        placeholder.parent.remove(placeholder);
                    }
                }
            });
            
            return placeholder;
        }

        // Specialized mesh generation
        switch(fixture.type) {
            case 'door':
                // Frame
                const frameGeo = new THREE.BoxGeometry(width, height, 0.15); // Wall thickness
                const doorGeo = new THREE.BoxGeometry(width * 0.9, height * 0.95, 0.05);
                
                const doorGroup = new THREE.Group();
                
                const doorMesh = new THREE.Mesh(doorGeo, material);
                doorMesh.position.y = height / 2;
                doorGroup.add(doorMesh);
                
                // Knob
                const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05), new THREE.MeshStandardMaterial({color: 0xffd700}));
                knob.position.set(width * 0.35, height/2, 0.05);
                doorGroup.add(knob);
                
                mesh = doorGroup;
                mesh.position.y = 0; // Starts at floor
                break;
                
            case 'window':
                const winFrameGeo = new THREE.BoxGeometry(width, height, 0.15);
                const glassMat = new THREE.MeshStandardMaterial({ 
                    color: 0x87ceeb, transparent: true, opacity: 0.3, roughness: 0.1 
                });
                const glassGeo = new THREE.BoxGeometry(width-0.1, height-0.1, 0.02);
                
                const winGroup = new THREE.Group();
                const frame = new THREE.Mesh(winFrameGeo, new THREE.MeshStandardMaterial({color: 0xffffff}));
                const glass = new THREE.Mesh(glassGeo, glassMat);
                
                winGroup.add(frame);
                winGroup.add(glass);
                
                mesh = winGroup;
                mesh.position.y = fixture.metadata.altitude || 1.0;
                break;

            case 'round_window':
                mesh = new THREE.Group();
                const r = width / 2;
                // Frame
                const torus = new THREE.Mesh(
                    new THREE.TorusGeometry(r, 0.05, 16, 32),
                    new THREE.MeshStandardMaterial({ color: 0xffffff })
                );
                // Glass
                const circle = new THREE.Mesh(
                    new THREE.CircleGeometry(r - 0.02, 32),
                    new THREE.MeshStandardMaterial({ 
                        color: 0x87ceeb, transparent: true, opacity: 0.3, roughness: 0.1, side: THREE.DoubleSide 
                    })
                );
                mesh.add(torus);
                mesh.add(circle);
                mesh.position.y = fixture.metadata.altitude || 1.5;
                break;

            case 'bathtub':
                geometry = new THREE.BoxGeometry(1.6, 0.5, 0.8);
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.y = 0.25;
                break;
            case 'toilet':
                geometry = new THREE.CylinderGeometry(0.3, 0.3, 0.6, 16);
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.y = 0.3;
                break;
            case 'sink':
                geometry = new THREE.BoxGeometry(0.6, 0.1, 0.5);
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.y = 0.85;
                break;
            case 'shower':
                const glassMat2 = new THREE.MeshStandardMaterial({ 
                    color: 0x88ccff, transparent: true, opacity: 0.3, roughness: 0.1 
                });
                geometry = new THREE.BoxGeometry(1, 2, 1);
                mesh = new THREE.Mesh(geometry, glassMat2);
                mesh.position.y = 1;
                break;
            
            // Kitchen
            case 'fridge':
                geometry = new THREE.BoxGeometry(width, height, depth);
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.y = height/2;
                // Add handle line
                const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), new THREE.MeshStandardMaterial({color: 0x888888}));
                handle.position.set(width/2 - 0.1, 0.2, depth/2 + 0.02);
                mesh.add(handle);
                break;
            
            case 'stove':
                mesh = new THREE.Group();
                const oven = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
                oven.position.y = height/2;
                mesh.add(oven);
                
                // Burners
                const burnerGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.02);
                const burnerMat = new THREE.MeshStandardMaterial({color: 0x111111});
                
                const b1 = new THREE.Mesh(burnerGeo, burnerMat); b1.position.set(-width/4, height+0.01, -depth/4);
                const b2 = new THREE.Mesh(burnerGeo, burnerMat); b2.position.set(width/4, height+0.01, -depth/4);
                const b3 = new THREE.Mesh(burnerGeo, burnerMat); b3.position.set(-width/4, height+0.01, depth/4);
                const b4 = new THREE.Mesh(burnerGeo, burnerMat); b4.position.set(width/4, height+0.01, depth/4);
                
                mesh.add(b1); mesh.add(b2); mesh.add(b3); mesh.add(b4);
                break;

            // Living Room
            case 'sofa':
                mesh = new THREE.Group();
                const seatHeight = 0.45;
                const backHeight = 0.8;
                const armHeight = 0.6;
                
                // Base/Seat
                const seat = new THREE.Mesh(new THREE.BoxGeometry(width, seatHeight, depth), material);
                seat.position.y = seatHeight/2;
                mesh.add(seat);
                
                // Back
                const back = new THREE.Mesh(new THREE.BoxGeometry(width, backHeight - seatHeight, 0.2), material);
                back.position.set(0, seatHeight + (backHeight-seatHeight)/2, -depth/2 + 0.1);
                mesh.add(back);
                
                // Arms
                const armGeo = new THREE.BoxGeometry(0.2, armHeight - seatHeight, depth);
                const leftArm = new THREE.Mesh(armGeo, material);
                leftArm.position.set(-width/2 + 0.1, seatHeight + (armHeight-seatHeight)/2, 0);
                
                const rightArm = new THREE.Mesh(armGeo, material);
                rightArm.position.set(width/2 - 0.1, seatHeight + (armHeight-seatHeight)/2, 0);
                
                mesh.add(leftArm);
                mesh.add(rightArm);
                break;

            case 'coffee_table':
                mesh = new THREE.Group();
                // Top
                const tableTop = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), material);
                tableTop.position.y = height;
                mesh.add(tableTop);
                // Legs
                const legGeo = new THREE.BoxGeometry(0.05, height, 0.05);
                const legMat = material; 
                const l1 = new THREE.Mesh(legGeo, legMat); l1.position.set(-width/2 + 0.1, height/2, -depth/2 + 0.1);
                const l2 = new THREE.Mesh(legGeo, legMat); l2.position.set(width/2 - 0.1, height/2, -depth/2 + 0.1);
                const l3 = new THREE.Mesh(legGeo, legMat); l3.position.set(-width/2 + 0.1, height/2, depth/2 - 0.1);
                const l4 = new THREE.Mesh(legGeo, legMat); l4.position.set(width/2 - 0.1, height/2, depth/2 - 0.1);
                mesh.add(l1); mesh.add(l2); mesh.add(l3); mesh.add(l4);
                break;

            // Bedroom
            case 'bed_queen':
            case 'bed_single':
                mesh = new THREE.Group();
                // Mattress base
                const mattress = new THREE.Mesh(new THREE.BoxGeometry(width, height*0.8, depth), material);
                mattress.position.y = height*0.4;
                mesh.add(mattress);
                
                // Headboard
                const headboard = new THREE.Mesh(new THREE.BoxGeometry(width, height * 1.5, 0.1), material);
                headboard.position.set(0, height * 0.75, -depth/2 + 0.05);
                mesh.add(headboard);
                
                // Pillow
                const pillowMat = new THREE.MeshStandardMaterial({color: 0xeeeeee});
                const pillow = new THREE.Mesh(new THREE.BoxGeometry(width * 0.4, 0.1, 0.4), pillowMat);
                pillow.position.set(0, height*0.8 + 0.05, -depth/2 + 0.4);
                mesh.add(pillow);
                break;

            // Office
            case 'desk':
                // Simple table basically
                mesh = new THREE.Group();
                const deskTop = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), material);
                deskTop.position.y = height;
                mesh.add(deskTop);
                
                // Side panels/legs
                const panelGeo = new THREE.BoxGeometry(0.05, height, depth * 0.8);
                const p1 = new THREE.Mesh(panelGeo, material); p1.position.set(-width/2 + 0.05, height/2, 0);
                const p2 = new THREE.Mesh(panelGeo, material); p2.position.set(width/2 - 0.05, height/2, 0);
                mesh.add(p1); mesh.add(p2);
                // Back panel
                const backPanel = new THREE.Mesh(new THREE.BoxGeometry(width - 0.1, height/2, 0.02), material);
                backPanel.position.set(0, height*0.75, -depth/2 + 0.1);
                mesh.add(backPanel);
                break;

            case 'bookshelf':
                mesh = new THREE.Group();
                // Frame
                const sideG = new THREE.BoxGeometry(0.05, height, depth);
                const s1 = new THREE.Mesh(sideG, material); s1.position.set(-width/2 + 0.025, height/2, 0);
                const s2 = new THREE.Mesh(sideG, material); s2.position.set(width/2 - 0.025, height/2, 0);
                mesh.add(s1); mesh.add(s2);
                
                // Shelves
                const numShelves = 5;
                for(let i=0; i<numShelves; i++) {
                    const shelf = new THREE.Mesh(new THREE.BoxGeometry(width-0.1, 0.02, depth), material);
                    shelf.position.y = (height / numShelves) * (i + 0.5);
                    mesh.add(shelf);
                }
                break;

            case 'kitchen_cabinet':
                geometry = new THREE.BoxGeometry(width, height, depth);
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.y = height/2;
                // Add handle
                const kHandle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), new THREE.MeshStandardMaterial({color: 0x888888}));
                kHandle.position.set(width/2 - 0.1, height-0.1, depth/2 + 0.01);
                mesh.add(kHandle);
                break;

            case 'kitchen_sink':
                mesh = new THREE.Group();
                const cab = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
                cab.position.y = height/2;
                mesh.add(cab);
                // Sink basin
                const basin = new THREE.Mesh(new THREE.BoxGeometry(width*0.8, 0.02, depth*0.8), new THREE.MeshStandardMaterial({color: 0xdddddd}));
                basin.position.y = height + 0.01;
                mesh.add(basin);
                // Tap
                const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2), new THREE.MeshStandardMaterial({color: 0x888888}));
                tap.position.set(0, height + 0.1, -depth/4);
                mesh.add(tap);
                break;

            case 'kitchen_island':
                geometry = new THREE.BoxGeometry(width, height, depth);
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.y = height/2;
                // Countertop overhang
                const counter = new THREE.Mesh(new THREE.BoxGeometry(width+0.1, 0.05, depth+0.1), material);
                counter.position.y = height;
                mesh.add(counter);
                break;

            // NEW FURNITURE
            case 'armchair':
                mesh = new THREE.Group();
                const acSeatHeight = 0.45;
                const acBackHeight = 0.9;
                // Base
                const acSeat = new THREE.Mesh(new THREE.BoxGeometry(width, acSeatHeight, depth), material);
                acSeat.position.y = acSeatHeight/2;
                mesh.add(acSeat);
                // Back
                const acBack = new THREE.Mesh(new THREE.BoxGeometry(width, acBackHeight-acSeatHeight, 0.2), material);
                acBack.position.set(0, acSeatHeight + (acBackHeight-acSeatHeight)/2, -depth/2 + 0.1);
                mesh.add(acBack);
                // Arms
                const acArmGeo = new THREE.BoxGeometry(0.15, 0.2, depth);
                const acLeft = new THREE.Mesh(acArmGeo, material); acLeft.position.set(-width/2+0.075, acSeatHeight+0.1, 0);
                const acRight = new THREE.Mesh(acArmGeo, material); acRight.position.set(width/2-0.075, acSeatHeight+0.1, 0);
                mesh.add(acLeft); mesh.add(acRight);
                break;

            case 'tv_stand':
                 geometry = new THREE.BoxGeometry(width, height, depth);
                 mesh = new THREE.Mesh(geometry, material);
                 mesh.position.y = height/2;
                 // TV
                 const tvScreen = new THREE.Mesh(new THREE.BoxGeometry(width*0.8, width*0.5, 0.05), new THREE.MeshStandardMaterial({color: 0x111111, roughness: 0.2}));
                 tvScreen.position.set(0, height + (width*0.5)/2 + 0.05, 0);
                 mesh.add(tvScreen);
                 break;

            case 'wardrobe':
                geometry = new THREE.BoxGeometry(width, height, depth);
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.y = height/2;
                // Doors line
                const gap = new THREE.Mesh(new THREE.BoxGeometry(0.01, height, depth+0.01), new THREE.MeshStandardMaterial({color:0x000000}));
                gap.position.set(0, height/2, depth/2);
                mesh.add(gap);
                break;

            case 'nightstand':
                geometry = new THREE.BoxGeometry(width, height, depth);
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.y = height/2;
                break;

            case 'office_chair':
                mesh = new THREE.Group();
                // Seat
                const ocSeat = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, depth), material);
                ocSeat.position.y = 0.5;
                mesh.add(ocSeat);
                // Back
                const ocBack = new THREE.Mesh(new THREE.BoxGeometry(width, 0.5, 0.05), material);
                ocBack.position.set(0, 0.75, -depth/2 + 0.025);
                mesh.add(ocBack);
                // Stem
                const ocStem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5), new THREE.MeshStandardMaterial({color: 0x333333}));
                ocStem.position.y = 0.25;
                mesh.add(ocStem);
                // Base
                const ocBase = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05), new THREE.MeshStandardMaterial({color: 0x333333}));
                ocBase.position.y = 0.025;
                mesh.add(ocBase);
                break;

            // DINING
            case 'dining_table':
                mesh = new THREE.Group();
                const dtTop = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), material);
                dtTop.position.y = height;
                mesh.add(dtTop);
                const dtLegGeo = new THREE.BoxGeometry(0.08, height, 0.08);
                const l1d = new THREE.Mesh(dtLegGeo, material); l1d.position.set(-width/2+0.1, height/2, -depth/2+0.1);
                const l2d = new THREE.Mesh(dtLegGeo, material); l2d.position.set(width/2-0.1, height/2, -depth/2+0.1);
                const l3d = new THREE.Mesh(dtLegGeo, material); l3d.position.set(-width/2+0.1, height/2, depth/2-0.1);
                const l4d = new THREE.Mesh(dtLegGeo, material); l4d.position.set(width/2-0.1, height/2, depth/2-0.1);
                mesh.add(l1d); mesh.add(l2d); mesh.add(l3d); mesh.add(l4d);
                break;
            
            case 'dining_chair':
                mesh = new THREE.Group();
                const dcSeat = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), material);
                dcSeat.position.y = height * 0.5; // Seat height
                mesh.add(dcSeat);
                const dcBack = new THREE.Mesh(new THREE.BoxGeometry(width, height*0.5, 0.05), material);
                dcBack.position.set(0, height*0.75, -depth/2 + 0.025);
                mesh.add(dcBack);
                const dcLegGeo = new THREE.BoxGeometry(0.04, height*0.5, 0.04);
                const dcl1 = new THREE.Mesh(dcLegGeo, material); dcl1.position.set(-width/2+0.05, height*0.25, -depth/2+0.05);
                const dcl2 = new THREE.Mesh(dcLegGeo, material); dcl2.position.set(width/2-0.05, height*0.25, -depth/2+0.05);
                const dcl3 = new THREE.Mesh(dcLegGeo, material); dcl3.position.set(-width/2+0.05, height*0.25, depth/2-0.05);
                const dcl4 = new THREE.Mesh(dcLegGeo, material); dcl4.position.set(width/2-0.05, height*0.25, depth/2-0.05);
                mesh.add(dcl1); mesh.add(dcl2); mesh.add(dcl3); mesh.add(dcl4);
                break;

            case 'sideboard':
                geometry = new THREE.BoxGeometry(width, height, depth);
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.y = height/2;
                // Doors
                const sbDoor1 = new THREE.Mesh(new THREE.BoxGeometry(width/2-0.05, height-0.1, 0.02), new THREE.MeshStandardMaterial({color: 0x333333}));
                sbDoor1.position.set(-width/4, 0, depth/2+0.01);
                const sbDoor2 = new THREE.Mesh(new THREE.BoxGeometry(width/2-0.05, height-0.1, 0.02), new THREE.MeshStandardMaterial({color: 0x333333}));
                sbDoor2.position.set(width/4, 0, depth/2+0.01);
                mesh.add(sbDoor1); mesh.add(sbDoor2);
                break;

            // DECOR
            case 'rug_large':
            case 'rug_round':
                geometry = fixture.type === 'rug_round' 
                    ? new THREE.CylinderGeometry(width/2, width/2, 0.02, 32)
                    : new THREE.BoxGeometry(width, 0.02, depth);
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.y = 0.01;
                break;

            case 'floor_lamp':
                mesh = new THREE.Group();
                const flBase = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 16), material);
                flBase.position.y = 0.025;
                mesh.add(flBase);
                const flPole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, height, 8), material);
                flPole.position.y = height/2;
                mesh.add(flPole);
                const flShade = new THREE.Mesh(new THREE.ConeGeometry(width/2, 0.4, 16, 1, true), new THREE.MeshStandardMaterial({color: 0xffffee, side: THREE.DoubleSide, transparent: true, opacity: 0.9}));
                flShade.position.y = height - 0.2;
                mesh.add(flShade);
                // Light bulb effect
                const bulb = new THREE.PointLight(0xffaa00, 0.5, 3);
                bulb.position.set(0, height - 0.3, 0);
                mesh.add(bulb);
                break;

            case 'potted_plant':
                mesh = new THREE.Group();
                const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.4, 12), new THREE.MeshStandardMaterial({color: 0x8b4513}));
                pot.position.y = 0.2;
                mesh.add(pot);
                const plant = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3), new THREE.MeshStandardMaterial({color: 0x228b22, flatShading: true}));
                plant.position.y = 0.5;
                mesh.add(plant);
                const plant2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25), new THREE.MeshStandardMaterial({color: 0x32cd32, flatShading: true}));
                plant2.position.set(0.1, 0.8, 0);
                mesh.add(plant2);
                break;
            
            case 'painting':
                geometry = new THREE.BoxGeometry(width, height, 0.05);
                mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color: 0x333333})); // Frame
                // Canvas
                const canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(width-0.1, height-0.1), material);
                canvasMesh.position.z = 0.03;
                mesh.add(canvasMesh);
                mesh.position.y = fixture.metadata.altitude || 1.5;
                break;

            // OUTDOOR
            case 'patio_table':
                mesh = new THREE.Group();
                const ptTop = new THREE.Mesh(new THREE.CylinderGeometry(width/2, width/2, 0.05, 32), material);
                ptTop.position.y = height;
                mesh.add(ptTop);
                const ptLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.2, height, 8), material);
                ptLeg.position.y = height/2;
                mesh.add(ptLeg);
                break;

            case 'patio_chair':
            case 'lounger':
                // Simple blocky representation
                 geometry = new THREE.BoxGeometry(width, height*0.1, depth);
                 mesh = new THREE.Mesh(geometry, material);
                 mesh.position.y = height*0.3;
                 // Back
                 const pBack = new THREE.Mesh(new THREE.BoxGeometry(width, height*0.6, 0.1), material);
                 pBack.position.set(0, height*0.3 + height*0.3, -depth/2 + 0.05);
                 mesh.add(pBack);
                 break;

            default:
                geometry = new THREE.BoxGeometry(width, height, depth);
                mesh = new THREE.Mesh(geometry, material);
                mesh.position.y = height/2;
        }
        return mesh;
    }
}