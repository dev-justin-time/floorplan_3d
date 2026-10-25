import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DEFAULT_ROOM_SIZE, WALL_HEIGHT, WALL_THICKNESS } from './world-space.js';
import { fitCameraToBounds } from './scene-camera.js';

class SharedViewer {
    constructor() {
        this.currentView = 'panorama';

        // Panorama State
        this.panoramaCamera = null;
        this.panoramaScene = null;
        this.panoramaRenderer = null;
        
        // 3D Floorplan State
        this.floorplanCamera = null;
        this.floorplanScene = null;
        this.floorplanRenderer = null;
        this.floorplanControls = null;
        
        // Panorama Interaction State
        this.isUserInteracting = false;
        this.lon = 0;
        this.lat = 0;
        this.onPointerDownLon = 0;
        this.onPointerDownLat = 0;
        this.onPointerDownMouseX = 0;
        this.onPointerDownMouseY = 0;
        
        // Bind animation loop to prevent garbage collection overhead
        this.animateBound = this.animate.bind(this);
        this.resizeObserver = null;
    }

    async init(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Container not found:', containerId);
            return;
        }
        this.container = container;

        const width = container.clientWidth;
        const height = container.clientHeight;

        // 1. Panorama Setup
        const panoramaCanvas = container.querySelector('#viewer-panorama-canvas');
        if (!panoramaCanvas) throw new Error('Panorama canvas not found');

        this.panoramaCamera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        this.panoramaCamera.position.set(0.001, 0, 0);
        this.panoramaScene = new THREE.Scene();

        this.panoramaRenderer = new THREE.WebGLRenderer({ canvas: panoramaCanvas, antialias: true });
            
        this.panoramaRenderer.setPixelRatio(window.devicePixelRatio);
        this.panoramaRenderer.setSize(width, height);

        await this.loadPanorama();

        // 2. 3D Floorplan Setup
        const view3DContainer = container.querySelector('#viewer-3d-view');
        if (!view3DContainer) throw new Error('3D view container not found');

        this.floorplanScene = new THREE.Scene();
        this.floorplanScene.background = new THREE.Color(0xeef1f4);

        this.floorplanCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
        this.floorplanCamera.position.set(8.2, 6.2, 8.2);

        this.floorplanRenderer = new THREE.WebGLRenderer({ antialias: true });
            
        this.floorplanRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.floorplanRenderer.setSize(width, height);
        this.floorplanRenderer.shadowMap.enabled = true;
        this.floorplanRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.floorplanRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.floorplanRenderer.toneMappingExposure = 0.72;
        view3DContainer.appendChild(this.floorplanRenderer.domElement);

        this.floorplanControls = new OrbitControls(this.floorplanCamera, this.floorplanRenderer.domElement);
        this.floorplanControls.enableDamping = true;
        this.floorplanControls.dampingFactor = 0.06;
        this.floorplanControls.maxPolarAngle = Math.PI / 2.05;

        // Same framing as the plan-driven scenes: one orbit direction, plan
        // centred, whole footprint in view.
        const half = DEFAULT_ROOM_SIZE / 2;
        fitCameraToBounds(
            this.floorplanCamera,
            this.floorplanControls,
            { minX: -half, maxX: half, minZ: -half, maxZ: half },
            { padding: 1.02, targetHeight: WALL_HEIGHT * 0.35 }
        );
        this.floorplanControls.minDistance = 4;
        this.floorplanControls.maxDistance = 26;

        this.setupEnvironment();
        this.setupLights();
        this.addSampleBathroom();
        this.setupEventListeners(container);
        
        // Start animation loop
        this.animateBound();
        console.log('SharedViewer initialized successfully');
    }

    createMaterial(type, params) {
        return type === 'basic' ? new THREE.MeshBasicMaterial(params) : new THREE.MeshStandardMaterial(params);
    }

    async loadPanorama() {
        const loader = new THREE.TextureLoader();
        return new Promise((resolve) => {
            loader.load(
                '/sc-bp-bath.png',
                (texture) => {
                    texture.mapping = THREE.EquirectangularReflectionMapping;
                    const geometry = new THREE.SphereGeometry(500, 60, 40);
                    geometry.scale(-1, 1, 1);
                    
                    const material = this.createMaterial('basic', { map: texture });
                    const mesh = new THREE.Mesh(geometry, material);
                    this.panoramaScene.add(mesh);
                    resolve();
                },
                undefined,
                () => {
                    console.warn('Failed to load panorama, using fallback color');
                    const geometry = new THREE.SphereGeometry(500, 60, 40);
                    geometry.scale(-1, 1, 1);
                    const material = this.createMaterial('basic', { color: 0x87ceeb });
                    const mesh = new THREE.Mesh(geometry, material);
                    this.panoramaScene.add(mesh);
                    resolve();
                }
            );
        });
    }

    /**
     * Image-based lighting from three's RoomEnvironment: gives the ceramic and
     * chrome something to reflect, which is what makes them read as materials
     * rather than flat shaded polygons.
     */
    setupEnvironment() {
        const pmrem = new THREE.PMREMGenerator(this.floorplanRenderer);
        pmrem.compileEquirectangularShader();
        const envScene = new RoomEnvironment(this.floorplanRenderer);
        this.environmentMap = pmrem.fromScene(envScene, 0.04).texture;
        this.floorplanScene.environment = this.environmentMap;
        envScene.dispose?.();
        pmrem.dispose();
    }

    setupLights() {
        this.floorplanScene.add(new THREE.AmbientLight(0xffffff, 0.08));

        const hemisphereLight = new THREE.HemisphereLight(0xdde9ff, 0x8d8378, 0.22);
        hemisphereLight.position.set(0, 12, 0);
        this.floorplanScene.add(hemisphereLight);

        // Key light sits across the room from the default camera, so the cast
        // shadows fall towards the viewer instead of hiding behind the fixtures.
        // Its frustum has to cover the 10x10 m room or the walls clip shadows.
        const keyLight = new THREE.DirectionalLight(0xfff2e2, 1.6);
        keyLight.position.set(-6.5, 10, -4.5);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(2048, 2048);
        keyLight.shadow.camera.left = -9;
        keyLight.shadow.camera.right = 9;
        keyLight.shadow.camera.top = 9;
        keyLight.shadow.camera.bottom = -9;
        keyLight.shadow.camera.near = 1;
        keyLight.shadow.camera.far = 40;
        keyLight.shadow.bias = -0.0004;
        keyLight.shadow.normalBias = 0.02;
        keyLight.shadow.radius = 3;
        // Bounds are set after construction, so the ortho projection still holds
        // its default +/-5 box until it is rebuilt.
        keyLight.shadow.camera.updateProjectionMatrix();
        this.floorplanScene.add(keyLight);

        // Fill from the camera side keeps the visible (far) wall faces lit.
        const fillLight = new THREE.DirectionalLight(0xdbe7ff, 0.75);
        fillLight.position.set(7, 7, 7);
        this.floorplanScene.add(fillLight);

        // Keep the grid just under the floor: coplanar lines z-fight with it.
        const gridHelper = new THREE.GridHelper(DEFAULT_ROOM_SIZE * 2, DEFAULT_ROOM_SIZE * 2, 0x9aa6b2, 0xc7cfd8);
        gridHelper.position.y = -0.01;
        gridHelper.material.transparent = true;
        gridHelper.material.opacity = 0.55;
        this.floorplanScene.add(gridHelper);
    }

    /**
     * Procedural tile map: no image assets to ship, and the grout lines give the
     * floor and walls readable scale.
     */
    createTileTexture({ base, grout, cells = 4, size = 512 }) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = base;
        ctx.fillRect(0, 0, size, size);

        const step = size / cells;
        ctx.strokeStyle = grout;
        ctx.lineWidth = Math.max(2, size / 170);
        for (let i = 0; i <= cells; i++) {
            const p = i * step;
            ctx.beginPath();
            ctx.moveTo(p, 0); ctx.lineTo(p, size);
            ctx.moveTo(0, p); ctx.lineTo(size, p);
            ctx.stroke();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = this.floorplanRenderer.capabilities.getMaxAnisotropy();
        return texture;
    }

    addSampleBathroom() {
        const maxAnisotropy = this.floorplanRenderer.capabilities.getMaxAnisotropy();

        const floorTexture = this.createTileTexture({ base: '#c6d0da', grout: '#9ca9b6', cells: 3 });
        floorTexture.repeat.set(8, 8);
        floorTexture.anisotropy = maxAnisotropy;

        const wallTexture = this.createTileTexture({ base: '#f7f9fb', grout: '#dbe2e9', cells: 6 });
        wallTexture.repeat.set(5, 1.6);
        wallTexture.anisotropy = maxAnisotropy;

        const ceramic = new THREE.MeshPhysicalMaterial({
            color: 0xffffff, roughness: 0.08, metalness: 0,
            clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1
        });
        const ceramicInner = new THREE.MeshPhysicalMaterial({
            color: 0xf2f8fc, roughness: 0.12, metalness: 0, envMapIntensity: 0.9
        });
        const chrome = new THREE.MeshStandardMaterial({
            color: 0xd7dce2, metalness: 1, roughness: 0.16, envMapIntensity: 1.5
        });
        const glass = new THREE.MeshPhysicalMaterial({
            color: 0xe4f2f7, roughness: 0.02, metalness: 0,
            transparent: true, opacity: 0.22, depthWrite: false,
            envMapIntensity: 1.4, side: THREE.DoubleSide
        });
        const oak = new THREE.MeshStandardMaterial({ color: 0xb98d63, roughness: 0.55, metalness: 0 });
        const stone = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.25, metalness: 0.05, envMapIntensity: 0.8 });
        const mirror = new THREE.MeshStandardMaterial({ color: 0xe6edf4, metalness: 1, roughness: 0.04, envMapIntensity: 1.6 });

        // Sample room uses the shared scale: metres, same wall height and
        // thickness as plan geometry built by ConversionEngine3D.
        const roomSize = DEFAULT_ROOM_SIZE;
        const half = roomSize / 2;
        const wallOffset = half - WALL_THICKNESS / 2;

        // Floor
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(roomSize, roomSize),
            new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.32, metalness: 0.02, envMapIntensity: 0.45 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.floorplanScene.add(floor);

        // Wall material shared by all four sides
        const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.82, metalness: 0.02, envMapIntensity: 0.4 });

        // in = direction pointing into the room; used to cut away the walls
        // standing between the camera and the interior.
        this.wallMeshes = [];
        const wallY = WALL_HEIGHT / 2;
        const walls = [
            { pos: [0, wallY, -wallOffset], size: [roomSize, WALL_HEIGHT, WALL_THICKNESS], in: [0, 0, 1] },
            { pos: [0, wallY, wallOffset], size: [roomSize, WALL_HEIGHT, WALL_THICKNESS], in: [0, 0, -1] },
            { pos: [-wallOffset, wallY, 0], size: [WALL_THICKNESS, WALL_HEIGHT, roomSize], in: [1, 0, 0] },
            { pos: [wallOffset, wallY, 0], size: [WALL_THICKNESS, WALL_HEIGHT, roomSize], in: [-1, 0, 0] }
        ];
        walls.forEach(({ pos, size, in: inward }) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), wallMat);
            mesh.position.set(...pos);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.inward = new THREE.Vector3(...inward);
            this.wallMeshes.push(mesh);
            this.floorplanScene.add(mesh);
        });

        const add = (mesh, x, y, z) => {
            mesh.position.set(x, y, z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.floorplanScene.add(mesh);
            return mesh;
        };

        // Bathtub against the back wall: shell, recessed basin, chrome spout.
        const tubX = -2.9, tubZ = -4.3;
        add(new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.58, 0.85, 4, 0.07), ceramic), tubX, 0.29, tubZ);
        add(new THREE.Mesh(new RoundedBoxGeometry(1.66, 0.4, 0.6, 4, 0.06), ceramicInner), tubX, 0.32, tubZ);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 12), chrome), tubX + 0.78, 0.75, tubZ);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.22, 12), chrome), tubX + 0.68, 0.86, tubZ)
            .rotation.z = Math.PI / 2;

        // Toilet: base, bowl and cistern.
        const wcX = 3.05, wcZ = -4.28;
        add(new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.12, 0.6, 4, 0.03), ceramic), wcX, 0.06, wcZ + 0.05);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.4, 24), ceramic), wcX, 0.24, wcZ + 0.12);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 24), ceramicInner), wcX, 0.46, wcZ + 0.12);
        add(new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.6, 0.2, 4, 0.04), ceramic), wcX, 0.5, wcZ - 0.2);

        // Vanity with basin, tap and mirror.
        const vanX = -3.0, vanZ = 3.95;
        add(new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.72, 0.55, 4, 0.03), oak), vanX, 0.36, vanZ);
        add(new THREE.Mesh(new RoundedBoxGeometry(1.58, 0.06, 0.6, 4, 0.02), stone), vanX, 0.75, vanZ);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.18, 0.16, 24), ceramicInner), vanX, 0.78, vanZ);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 12), chrome), vanX, 0.9, vanZ - 0.22);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.16), chrome), vanX, 1.04, vanZ - 0.14);
        add(new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.85, 0.04, 4, 0.02), mirror), vanX, 1.65, vanZ + 0.45);

        // Walk-in shower: tray, chrome frame and glass panels.
        const shX = 3.0, shZ = 3.95;
        add(new THREE.Mesh(new RoundedBoxGeometry(1.35, 0.07, 1.35, 4, 0.02), stone), shX, 0.035, shZ);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 12), chrome), shX + 0.62, 1.05, shZ - 0.62);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.04), chrome), shX + 0.45, 2.05, shZ - 0.62);
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 20), chrome), shX + 0.28, 2.03, shZ - 0.62);

        const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.95, 0.015), glass);
        frontGlass.position.set(shX, 1.0, shZ - 0.67);
        this.floorplanScene.add(frontGlass);

        const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(0.015, 1.95, 1.35), glass);
        sideGlass.position.set(shX - 0.67, 1.0, shZ);
        this.floorplanScene.add(sideGlass);
        add(new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.04, 0.04), chrome), shX, 1.98, shZ - 0.67);

        // Towel rail on the wall for a bit of scale reference.
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 10), chrome), -0.4, 1.55, 4.86)
            .rotation.z = Math.PI / 2;
    }

    setupEventListeners(container) {
        const panoramaCanvas = container.querySelector('#viewer-panorama-canvas');

        const onPointerDown = (e) => {
            e.preventDefault();
            this.isUserInteracting = true;
            this.onPointerDownMouseX = e.clientX;
            this.onPointerDownMouseY = e.clientY;
            this.onPointerDownLon = this.lon;
            this.onPointerDownLat = this.lat;
            panoramaCanvas.style.cursor = 'grabbing';
        };

        const onPointerMove = (e) => {
            if (this.isUserInteracting) {
                this.lon = (e.clientX - this.onPointerDownMouseX) * 0.15 + this.onPointerDownLon;
                this.lat = (e.clientY - this.onPointerDownMouseY) * 0.15 + this.onPointerDownLat;
            }
        };

        const onPointerUp = () => {
            this.isUserInteracting = false;
            panoramaCanvas.style.cursor = 'grab';
        };

        panoramaCanvas.addEventListener('pointerdown', onPointerDown);
        panoramaCanvas.addEventListener('pointermove', onPointerMove);
        panoramaCanvas.addEventListener('pointerup', onPointerUp);
        panoramaCanvas.addEventListener('pointerleave', onPointerUp);

        panoramaCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const fov = this.panoramaCamera.fov + e.deltaY * 0.05;
            this.panoramaCamera.fov = THREE.MathUtils.clamp(fov, 25, 100);
            this.panoramaCamera.updateProjectionMatrix();
        }, { passive: false });

        // The view switch sits outside the viewer container on the marketing
        // pages, so fall back to a document lookup instead of container scope.
        const toggleBtn = container.querySelector('#viewer-toggle') || document.getElementById('viewer-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('change', () => this.toggleView());
        }

        // Use ResizeObserver instead of window resize for robust container-specific scaling
        this.resizeObserver = new ResizeObserver(() => this.handleResize(container));
        this.resizeObserver.observe(container);
    }

    handleResize(container = this.container) {
        if (!container) return;
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (!width || !height) return;

        if (this.panoramaCamera && this.panoramaRenderer) {
            this.panoramaCamera.aspect = width / height;
            this.panoramaCamera.updateProjectionMatrix();
            this.panoramaRenderer.setSize(width, height);
        }

        if (this.floorplanCamera && this.floorplanRenderer) {
            this.floorplanCamera.aspect = width / height;
            this.floorplanCamera.updateProjectionMatrix();
            this.floorplanRenderer.setSize(width, height);
        }
    }

    toggleView() {
        const panoramaCanvas = document.getElementById('viewer-panorama-canvas');
        const view3D = document.getElementById('viewer-3d-view');

        this.currentView = this.currentView === 'panorama' ? '3d' : 'panorama';
        const showPanorama = this.currentView === 'panorama';

        if (panoramaCanvas) panoramaCanvas.style.display = showPanorama ? 'block' : 'none';
        if (view3D) view3D.style.display = showPanorama ? 'none' : 'block';

        // Both canvases are sized from the container, which keeps its size while
        // a view is hidden — re-sync so the newly shown view is not stretched.
        this.handleResize();

        if (showPanorama && this.panoramaRenderer) {
            this.panoramaCamera.aspect = (this.container?.clientWidth || 1) / (this.container?.clientHeight || 1);
            this.panoramaCamera.updateProjectionMatrix();
            this.panoramaRenderer.render(this.panoramaScene, this.panoramaCamera);
        } else if (this.floorplanRenderer) {
            this.floorplanControls?.update();
            this.floorplanRenderer.render(this.floorplanScene, this.floorplanCamera);
        }
    }

    /**
     * Cutaway: drop the walls standing between the camera and the room, so
     * orbiting always looks into the interior instead of at a closed box.
     */
    updateWallVisibility() {
        if (!this.wallMeshes || !this.wallMeshes.length) return;
        const offset = this._wallOffset || (this._wallOffset = new THREE.Vector3());
        for (const wall of this.wallMeshes) {
            offset.copy(this.floorplanCamera.position).sub(wall.position);
            wall.visible = offset.dot(wall.userData.inward) > -0.05;
        }
    }

    animate() {
        requestAnimationFrame(this.animateBound);

        if (this.currentView === 'panorama' && this.panoramaRenderer) {
            this.lat = Math.max(-89, Math.min(89, this.lat));
            const phi = THREE.MathUtils.degToRad(90 - this.lat);
            const theta = THREE.MathUtils.degToRad(this.lon);

            const x = Math.sin(phi) * Math.cos(theta);
            const y = Math.cos(phi);
            const z = Math.sin(phi) * Math.sin(theta);

            this.panoramaCamera.lookAt(x, y, z);
            this.panoramaRenderer.render(this.panoramaScene, this.panoramaCamera);
        } else if (this.currentView === '3d' && this.floorplanRenderer) {
            this.floorplanControls.update();
            this.updateWallVisibility();
            this.floorplanRenderer.render(this.floorplanScene, this.floorplanCamera);
        }
    }

    /**
     * Cleanup method to prevent memory leaks when the viewer is destroyed/unmounted
     */
    dispose() {
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.panoramaRenderer) this.panoramaRenderer.dispose();
        if (this.floorplanRenderer) this.floorplanRenderer.dispose();
        if (this.floorplanControls) this.floorplanControls.dispose();
        
        this.panoramaScene?.clear();
        this.floorplanScene?.clear();
    }
}

export { SharedViewer };

