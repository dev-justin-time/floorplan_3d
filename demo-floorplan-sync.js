import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ConversionEngine3D } from './3dConversionEngine.js';

export class FloorplanSyncDemo {
  constructor(canvas2DId, container3DId) {
    this.canvas2D = document.getElementById(canvas2DId);
    this.ctx = this.canvas2D?.getContext('2d');
    this.container3D = document.getElementById(container3DId);
    
    if (!this.canvas2D || !this.container3D) {
      console.error('FloorplanSyncDemo: Required elements not found');
      return;
    }
    
    this.walls = [];
    this.drawing = false;
    this.startPoint = null;
    this.SCALE = 30;
    
    this.init3D();
    this.setupCanvas2D();
    this.draw2D();
  }
  
  init3D() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);
    this.camera = new THREE.PerspectiveCamera(
      60, 
      this.container3D.clientWidth / this.container3D.clientHeight, 
      0.1, 
      1000
    );
    this.camera.position.set(8, 6, 8);
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.container3D.clientWidth, this.container3D.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.container3D.appendChild(this.renderer.domElement);
    
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 15, 10);
    dirLight.castShadow = true;
    this.scene.add(dirLight);
    
    const gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0xcccccc);
    this.scene.add(gridHelper);
    
    this.engine = new ConversionEngine3D(this.scene);
    
    this.animate3D();
  }
  
  setupCanvas2D() {
    this.canvas2D.addEventListener('pointerdown', (e) => {
      const rect = this.canvas2D.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      if (!this.drawing) {
        this.startPoint = { x, y };
        this.drawing = true;
      } else {
        this.walls.push({ 
          start: this.startPoint, 
          end: { x, y },
          id: `wall_${Date.now()}`
        });
        this.startPoint = { x, y };
        this.update3D();
      }
      
      this.draw2D();
    });
    
    this.canvas2D.addEventListener('dblclick', () => {
      this.drawing = false;
      this.startPoint = null;
      this.draw2D();
    });
  }
  
  draw2D() {
    if (!this.ctx) return;
    
    this.ctx.fillStyle = '#f8f8f8';
    this.ctx.fillRect(0, 0, this.canvas2D.width, this.canvas2D.height);
    
    // Grid
    this.ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    this.ctx.lineWidth = 1;
    const gridSize = 20;
    for(let x = 0; x < this.canvas2D.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas2D.height);
      this.ctx.stroke();
    }
    for(let y = 0; y < this.canvas2D.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas2D.width, y);
      this.ctx.stroke();
    }
    
    // Walls
    this.ctx.strokeStyle = '#3b82f6';
    this.ctx.lineWidth = 6;
    this.ctx.lineCap = 'round';
    
    this.walls.forEach(wall => {
      this.ctx.beginPath();
      this.ctx.moveTo(wall.start.x, wall.start.y);
      this.ctx.lineTo(wall.end.x, wall.end.y);
      this.ctx.stroke();
      
      // Draw dimension
      const midX = (wall.start.x + wall.end.x) / 2;
      const midY = (wall.start.y + wall.end.y) / 2;
      const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
      const lenM = (len / this.SCALE).toFixed(1) + 'm';
      
      this.ctx.fillStyle = '#000';
      this.ctx.font = 'bold 11px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(lenM, midX, midY - 10);
    });
    
    if (this.drawing && this.startPoint) {
      this.ctx.fillStyle = '#3b82f6';
      this.ctx.beginPath();
      this.ctx.arc(this.startPoint.x, this.startPoint.y, 6, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }
  
  update3D() {
    const appState = {
      stories: [{
        id: 'demo_story',
        walls: this.walls,
        fixtures: [],
        height: 2.7
      }],
      currentStoryIndex: 0,
      walls: this.walls,
      fixtures: [],
      fixtureStyles: {},
      showCeiling: false,
      showRoof: false,
      defaultWallTexture: null,
      defaultFloorTexture: 'tile'
    };
    
    this.engine.convert(appState, this.canvas2D.width, this.canvas2D.height);
  }
  
  animate3D() {
    requestAnimationFrame(() => this.animate3D());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  
  reset() {
    this.walls = [];
    this.drawing = false;
    this.startPoint = null;
    this.draw2D();
    this.update3D();
  }
}


```