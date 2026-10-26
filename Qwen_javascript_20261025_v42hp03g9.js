// SharedViewer.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SharedViewer {
    constructor() {
        this.currentView = 'panorama';
        this.panoramaCamera = null;
        this.panoramaScene = null;
        this.panoramaRenderer = null;
        this.floorplanCamera = null;
        this.floorplanScene = null;
        this.floorplanRenderer = null;
        this.floorplanControls = null;
        
        this.isUserInteracting = false;
        this.lon = 0;
        this.lat = 0;
        this.onPointerDownLon = 0;
        this.onPointerDownLat = 0;
        this.onPointerDownMouseX = 0;
        this.onPointerDownMouseY = 0;
        
        this.animateBound = this.animate.bind(this);
        this.resizeObserver = null;
    }

    async init(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return console.error('Container not found:', containerId);

        const width = container.clientWidth;
        const height = container.clientHeight;

        // 1. Panorama Setup
        const panoramaCanvas = document.getElementById('viewer-panorama-canvas');
        this.panoramaCamera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        this.panoramaCamera.position.set(0.001, 0, 0);
        this.panoramaScene = new THREE.Scene();

        this.panoramaRenderer = new THREE.WebGLRenderer({ canvas: panoramaCanvas, antialias: true });
        this.panoramaRenderer.setPixelRatio(window.devicePixelRatio);
        this.panoramaRenderer.setSize(width, height);
        await this.loadPanorama();

        // 2. 3D Floorplan Setup
        const view3DContainer = document.getElementById('viewer-3d-view');
        this.floorplanScene = new THREE.Scene();
        this.floorplanScene.background = new THREE.Color(0xf8f9fa);

        this.floorplanCamera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
        this.floorplanCamera.position.set(8, 6, 8);

        this.floorplanRenderer = new THREE.WebGLRenderer({ antialias: true });
        this.floorplanRenderer.setSize(width, height);
        this.floorplanRenderer.shadowMap.enabled = true;
        this.floorplanRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
        view3DContainer.appendChild(this.floorplanRenderer.domElement);

        this.floorplanControls = new OrbitControls(this.floorplanCamera, this.floorplanRenderer.domElement);
        this.floorplanControls.enableDamping = true;
        this.floorplanControls.dampingFactor = 0.05;
        this.floorplanControls.maxPolarAngle = Math.PI / 2 - 0.05;

        this.setupLights();
        this.buildDemoFloorplan();
        this.setupEventListeners(container);
        
        this.animateBound();
    }

    async loadPanorama() {
        const loader = new THREE.TextureLoader();
        return new Promise((resolve) => {
            loader.load(
                '/sc-bp-bath.png', // Your panorama image path
                (texture) => {
                    texture.mapping = THREE.EquirectangularReflectionMapping;
                    const geometry = new THREE.SphereGeometry(500, 60, 40);
                    geometry.scale(-1, 1, 1); // Invert to view from inside
                    const material = new THREE.MeshBasicMaterial({ map: texture });
                    this.panoramaScene.add(new THREE.Mesh(geometry, material));
                    resolve();
                },
                undefined,
                () => {
                    console.warn('Panorama image missing, using fallback');
                    const geometry = new THREE.SphereGeometry(500, 60, 40);
                    geometry.scale(-1, 1, 1);
                    const material = new THREE.MeshBasicMaterial({ color: 0x87ceeb });
                    this.panoramaScene.add(new THREE.Mesh(geometry, material));
                    resolve();
                }
            );
        });
    }

    setupLights() {
        this.floorplanScene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        hemi.position.set(0, 20, 0);
        this.floorplanScene.add(hemi);

        const dir = new THREE.DirectionalLight(0xffffff, 1.0);
        dir.position.set(10, 15, 10);
        dir.castShadow = true;
        dir.shadow.mapSize.set(2048, 2048);
        dir.shadow.bias = -0.0001;
        this.floorplanScene.add(dir);
        
        this.floorplanScene.add(new THREE.GridHelper(20, 20, 0xcccccc, 0xe5e7eb));
    }

    buildDemoFloorplan() {
        const floorMat = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.8 });
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.floorplanScene.add(floor);

        const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
        const walls = [
            { pos: [0, 1.5, -6], size: [12, 3, 0.2] },
            { pos: [0, 1.5, 6], size: [12, 3, 0.2] },
            { pos: [-6, 1.5, 0], size: [0.2, 3, 12] },
            { pos: [6, 1.5, 0], size: [0.2, 3, 12] }
        ];

        walls.forEach(w => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(...w.size), wallMat);
            mesh.position.set(...w.pos);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.floorplanScene.add(mesh);
        });

        // Kitchen Island (Matches your #13a4ec primary color)
        const islandMat = new THREE.MeshStandardMaterial({ color: 0x13a4ec, roughness: 0.4 });
        const island = new THREE.Mesh(new THREE.BoxGeometry(3, 0.9, 1.5), islandMat);
        island.position.set(0, 0.45, 0);
        island.castShadow = true;
        this.floorplanScene.add(island);
    }

    // Public method to inject processed walls from the FloorPlanProcessor
    updateFloorplan(walls) {
        // Clear existing walls/furniture
        const toRemove = [];
        this.floorplanScene.traverse(child => {
            if (child.isMesh && child.geometry.type === 'BoxGeometry') toRemove.push(child);
        });
        toRemove.forEach(obj => {
            obj.geometry.dispose();
            obj.material.dispose();
            this.floorplanScene.remove(obj);
        });

        // Add new processed walls
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
        walls.forEach(wall => {
            const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) / 30; // Scale down
            const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
            
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 3, 0.2), wallMat);
            mesh.position.set(
                ((wall.start.x + wall.end.x) / 2 - 300) / 30, // Center and scale
                1.5,
                ((wall.start.y + wall.end.y) / 2 - 300) / 30
            );
            mesh.rotation.y = -angle;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.floorplanScene.add(mesh);
        });
        
        // Auto-focus camera
        this.floorplanCamera.position.set(8, 8, 8);
        this.floorplanControls.target.set(0, 1.5, 0);
        this.floorplanControls.update();
    }

    setupEventListeners(container) {
        const panoramaCanvas = document.getElementById('viewer-panorama-canvas');

        panoramaCanvas.addEventListener('pointerdown', (e) => {
            this.isUserInteracting = true;
            this.onPointerDownMouseX = e.clientX;
            this.onPointerDownMouseY = e.clientY;
            this.onPointerDownLon = this.lon;
            this.onPointerDownLat = this.lat;
            panoramaCanvas.style.cursor = 'grabbing';
        });

        panoramaCanvas.addEventListener('pointermove', (e) => {
            if (this.isUserInteracting) {
                this.lon = (e.clientX - this.onPointerDownMouseX) * 0.15 + this.onPointerDownLon;
                this.lat = (e.clientY - this.onPointerDownMouseY) * 0.15 + this.onPointerDownLat;
            }
        });

        const pointerUp = () => {
            this.isUserInteracting = false;
            panoramaCanvas.style.cursor = 'grab';
        };
        panoramaCanvas.addEventListener('pointerup', pointerUp);
        panoramaCanvas.addEventListener('pointerleave', pointerUp);

        panoramaCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.panoramaCamera.fov = THREE.MathUtils.clamp(this.panoramaCamera.fov + e.deltaY * 0.05, 25, 100);
            this.panoramaCamera.updateProjectionMatrix();
        }, { passive: false });

        document.getElementById('viewer-toggle')?.addEventListener('change', () => this.toggleView());
        
        this.resizeObserver = new ResizeObserver(() => this.handleResize(container));
        this.resizeObserver.observe(container);
    }

    handleResize(container) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (this.panoramaCamera) {
            this.panoramaCamera.aspect = width / height;
            this.panoramaCamera.updateProjectionMatrix();
            this.panoramaRenderer.setSize(width, height);
        }
        if (this.floorplanCamera) {
            this.floorplanCamera.aspect = width / height;
            this.floorplanCamera.updateProjectionMatrix();
            this.floorplanRenderer.setSize(width, height);
        }
    }

    toggleView() {
        const pCanvas = document.getElementById('viewer-panorama-canvas');
        const v3D = document.getElementById('viewer-3d-view');
        if (this.currentView === 'panorama') {
            this.currentView = '3d';
            pCanvas.style.display = 'none';
            v3D.style.display = 'block';
        } else {
            this.currentView = 'panorama';
            pCanvas.style.display = 'block';
            v3D.style.display = 'none';
        }
    }

    animate() {
        requestAnimationFrame(this.animateBound);
        if (this.currentView === 'panorama') {
            this.lat = Math.max(-89, Math.min(89, this.lat));
            const phi = THREE.MathUtils.degToRad(90 - this.lat);
            const theta = THREE.MathUtils.degToRad(this.lon);
            this.panoramaCamera.lookAt(
                Math.sin(phi) * Math.cos(theta),
                Math.cos(phi),
                Math.sin(phi) * Math.sin(theta)
            );
            this.panoramaRenderer.render(this.panoramaScene, this.panoramaCamera);
        } else {
            this.floorplanControls.update();
            this.floorplanRenderer.render(this.floorplanScene, this.floorplanCamera);
        }
    }
}