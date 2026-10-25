import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class SharedViewer {
    constructor() {
        this.currentView = 'panorama';
        this.isWebGPU = false;
        
        // WebGPU is loaded lazily: its module graph is heavy and the pages
        // must still work on WebGL-only browsers.
        this.WebGPURendererClass = null;
        this.nodeMaterials = null;

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

        const width = container.clientWidth;
        const height = container.clientHeight;

        // 1. Determine Renderer Capability (WebGPU with WebGL fallback)
        this.isWebGPU = await this.detectWebGPU();
        console.log(`Initializing SharedViewer with ${this.isWebGPU ? 'WebGPU' : 'WebGL'} renderer`);

        // 2. Panorama Setup
        const panoramaCanvas = container.querySelector('#viewer-panorama-canvas');
        if (!panoramaCanvas) throw new Error('Panorama canvas not found');

        this.panoramaCamera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        this.panoramaCamera.position.set(0.001, 0, 0);
        this.panoramaScene = new THREE.Scene();

        this.panoramaRenderer = this.createRenderer({ canvas: panoramaCanvas, antialias: true });
            
        this.panoramaRenderer.setPixelRatio(window.devicePixelRatio);
        this.panoramaRenderer.setSize(width, height);

        await this.loadPanorama();

        // 3. 3D Floorplan Setup
        const view3DContainer = container.querySelector('#viewer-3d-view');
        if (!view3DContainer) throw new Error('3D view container not found');

        this.floorplanScene = new THREE.Scene();
        this.floorplanScene.background = new THREE.Color(0xf0f0f0);

        this.floorplanCamera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
        this.floorplanCamera.position.set(8, 6, 8);

        this.floorplanRenderer = this.createRenderer({ antialias: true });
            
        this.floorplanRenderer.setSize(width, height);
        this.floorplanRenderer.shadowMap.enabled = true;
        this.floorplanRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
        view3DContainer.appendChild(this.floorplanRenderer.domElement);

        this.floorplanControls = new OrbitControls(this.floorplanCamera, this.floorplanRenderer.domElement);
        this.floorplanControls.enableDamping = true;
        this.floorplanControls.dampingFactor = 0.05;
        this.floorplanControls.maxPolarAngle = Math.PI / 2;

        this.setupLights();
        this.addSampleBathroom();
        this.setupEventListeners(container);
        
        // Start animation loop
        this.animateBound();
        console.log('SharedViewer initialized successfully');
    }

    /**
     * Feature-detect WebGPU. Older three builds expose WebGPURenderer.isAvailable();
     * newer ones rely on navigator.gpu + a working adapter.
     */
    async detectWebGPU() {
        if (typeof navigator === 'undefined' || !navigator.gpu) return false;

        try {
            // Some browsers/environments never settle the adapter request;
            // don't let that block the WebGL fallback.
            const adapter = await Promise.race([
                navigator.gpu.requestAdapter().catch(() => null),
                new Promise((resolve) => setTimeout(() => resolve(null), 1500))
            ]);
            if (!adapter) return false;

            // Load the WebGPU renderer + node materials only when usable.
            const loaded = await Promise.race([
                Promise.all([
                    import('three/addons/renderers/webgpu/WebGPURenderer.js'),
                    import('three/nodes')
                ]),
                new Promise((resolve) => setTimeout(() => resolve(null), 5000))
            ]);

            if (!loaded) return false;

            this.WebGPURendererClass = loaded[0].default;
            this.nodeMaterials = loaded[1];
            return Boolean(this.WebGPURendererClass);
        } catch (error) {
            console.warn('WebGPU detection failed, using WebGL:', error);
            return false;
        }
    }

    createRenderer(options) {
        if (this.isWebGPU && this.WebGPURendererClass) {
            return new this.WebGPURendererClass(options);
        }
        return new THREE.WebGLRenderer(options);
    }

    /**
     * Material Factory: Returns the correct material type based on active renderer.
     * This prevents duplicating scene setup logic for WebGPU vs WebGL.
     */
    createMaterial(type, params) {
        // Keep the shared scene on core materials: the WebGPU backend converts
        // them internally, and node materials are still experimental in r160.
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

    setupLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.floorplanScene.add(ambientLight);

        const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        hemisphereLight.position.set(0, 20, 0);
        this.floorplanScene.add(hemisphereLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 15, 10);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.bias = -0.0001; // Prevents shadow acne on flat surfaces
        this.floorplanScene.add(directionalLight);

        const gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0xcccccc);
        this.floorplanScene.add(gridHelper);
    }

    addSampleBathroom() {
        // Floor
        const floorMat = this.createMaterial('standard', { color: 0xf5f5f5, roughness: 0.8, metalness: 0.2 });
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.floorplanScene.add(floor);

        // Walls (Consolidated for cleaner code)
        const wallMat = this.createMaterial('standard', { color: 0xe0e0e0, roughness: 0.7, metalness: 0.1 });
        const walls = [
            { pos: [0, 1.35, -5], size: [10, 2.7, 0.15] },
            { pos: [0, 1.35, 5], size: [10, 2.7, 0.15] },
            { pos: [-5, 1.35, 0], size: [0.15, 2.7, 10] },
            { pos: [5, 1.35, 0], size: [0.15, 2.7, 10] }
        ];

        walls.forEach(w => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(...w.size), wallMat);
            mesh.position.set(...w.pos);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.floorplanScene.add(mesh);
        });

        // Fixtures
        const fixtureMat = this.createMaterial('standard', { color: 0xffffff, roughness: 0.2, metalness: 0.1 });
        
        const bathtub = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.8), fixtureMat);
        bathtub.position.set(-3, 0.25, -4);
        bathtub.castShadow = true; bathtub.receiveShadow = true;
        this.floorplanScene.add(bathtub);

        const toilet = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 16), fixtureMat);
        toilet.position.set(3, 0.3, -4);
        toilet.castShadow = true; toilet.receiveShadow = true;
        this.floorplanScene.add(toilet);

        const sink = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.5), fixtureMat);
        sink.position.set(-3, 0.9, 4);
        sink.castShadow = true; sink.receiveShadow = true;
        this.floorplanScene.add(sink);

        const showerMat = this.createMaterial('standard', { color: 0xffffff, transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.5 });
        const shower = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), showerMat);
        shower.position.set(3, 1, 4);
        shower.castShadow = true; shower.receiveShadow = true;
        this.floorplanScene.add(shower);
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

        const toggleBtn = container.querySelector('#viewer-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('change', () => this.toggleView());
        }

        // Use ResizeObserver instead of window resize for robust container-specific scaling
        this.resizeObserver = new ResizeObserver(() => this.handleResize(container));
        this.resizeObserver.observe(container);
    }

    handleResize(container) {
        const width = container.clientWidth;
        const height = container.clientHeight;

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

        if (this.currentView === 'panorama') {
            this.currentView = '3d';
            if (panoramaCanvas) panoramaCanvas.style.display = 'none';
            if (view3D) view3D.style.display = 'block';
        } else {
            this.currentView = 'panorama';
            if (panoramaCanvas) panoramaCanvas.style.display = 'block';
            if (view3D) view3D.style.display = 'none';
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
            
            // WebGPU requires renderAsync, WebGL uses standard render
            if (this.isWebGPU && this.panoramaRenderer.renderAsync) {
                this.panoramaRenderer.renderAsync(this.panoramaScene, this.panoramaCamera);
            } else {
                this.panoramaRenderer.render(this.panoramaScene, this.panoramaCamera);
            }
        } else if (this.currentView === '3d' && this.floorplanRenderer) {
            this.floorplanControls.update();
            
            if (this.isWebGPU && this.floorplanRenderer.renderAsync) {
                this.floorplanRenderer.renderAsync(this.floorplanScene, this.floorplanCamera);
            } else {
                this.floorplanRenderer.render(this.floorplanScene, this.floorplanCamera);
            }
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

