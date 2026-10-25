import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import WebGPURenderer from 'three/addons/renderers/webgpu/WebGPURenderer.js';
import { color, cos, float, sin, timerLocal, vec3, vec4 } from 'three/nodes';

// Lightweight React wrapper around a Three.js WebGPU nodes scene
export default function LabWebGPUReactDemo() {
  const containerRef = useRef(null);
  const [status, setStatus] = useState('Checking WebGPU…');

  useEffect(() => {
    let renderer, animationId;
    let disposed = false;

    (async () => {
      try {
        if (!(await WebGPURenderer.isAvailable())) {
          setStatus('WebGPU not available • falling back to static message');
          return;
        }
        setStatus('WebGPU active');

        const container = containerRef.current;
        if (!container) return;

        const width = container.clientWidth || 320;
        const height = container.clientHeight || 220;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#020617');

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        camera.position.set(3, 3, 3);
        camera.lookAt(0, 0, 0);

        const dirLight = new THREE.DirectionalLight(0xffffff, 2);
        dirLight.position.set(5, 5, 5);
        scene.add(dirLight);

        const ambient = new THREE.AmbientLight(0x404040, 3);
        scene.add(ambient);

        const geometry = new THREE.TorusKnotGeometry(1, 0.3, 128, 32);
        const material = new THREE.MeshStandardNodeMaterial();

        const time = timerLocal();
        const varyingColor = vec3(
          sin(time.mul(2.0)),
          cos(time.mul(1.5)),
          sin(time.mul(1.0))
        );

        material.colorNode = vec4(varyingColor.add(1.0).mul(0.5), 1.0);
        material.roughness = float(0.2);
        material.metalness = float(0.8);

        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        const floorGeo = new THREE.PlaneGeometry(10, 10);
        const floorMat = new THREE.MeshStandardMaterial({
          color: 0x111827,
          roughness: 0.1,
          metalness: 0.4
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -1.5;
        scene.add(floor);

        renderer = new WebGPURenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(width, height);
        container.appendChild(renderer.domElement);

        const onResize = () => {
          if (!container || !renderer) return;
          const w = container.clientWidth || width;
          const h = container.clientHeight || height;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        };
        window.addEventListener('resize', onResize);

        const animate = () => {
          if (disposed) return;
          animationId = requestAnimationFrame(animate);
          mesh.rotation.y += 0.01;
          mesh.rotation.z += 0.005;
          renderer.render(scene, camera);
        };
        animate();

        return () => {
          disposed = true;
          if (animationId) cancelAnimationFrame(animationId);
          window.removeEventListener('resize', onResize);
          if (renderer) {
            container?.removeChild(renderer.domElement);
            renderer.dispose();
          }
          geometry.dispose();
          floorGeo.dispose();
          material.dispose();
          floorMat.dispose();
        };
      } catch (err) {
        console.error('WebGPU init error', err);
        setStatus('WebGPU initialization failed');
      }
    })();

    return () => {
      // cleanup handled inside async IIFE via disposed flag
      disposed = true;
    };
  }, []);

  return React.createElement(
    'div',
    { className: 'w-full h-[260px] bg-slate-950 rounded-lg overflow-hidden relative' },
    React.createElement('div', {
      ref: containerRef,
      className: 'w-full h-full'
    }),
    React.createElement(
      'div',
      { className: 'absolute top-3 left-3 bg-black/60 text-white text-[11px] px-2 py-1.5 rounded-full' },
      status
    ),
    React.createElement(
      'div',
      { className: 'absolute bottom-3 left-3 text-[10px] text-slate-300 bg-black/40 px-2 py-1 rounded' },
      'Three.js Nodes • WebGPURenderer'
    )
  );
}


