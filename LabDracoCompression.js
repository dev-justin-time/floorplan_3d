import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

function DracoModel({ url }) {
  const [model, setModel] = useState(null);
  const [stats, setStats] = useState({ vertices: 0, triangles: 0, compressionRatio: 0 });
  
  useEffect(() => {
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(dracoLoader);
    
    loader.load(url, (gltf) => {
      setModel(gltf.scene);
      
      let totalVertices = 0;
      let totalTriangles = 0;
      
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          totalVertices += child.geometry.attributes.position.count;
          if (child.geometry.index) {
            totalTriangles += child.geometry.index.count / 3;
          }
        }
      });
      
      setStats({
        vertices: totalVertices,
        triangles: totalTriangles,
        compressionRatio: 0.75 // Simulated
      });
    });
  }, [url]);
  
  return model ? React.createElement('primitive', { object: model }) : null;
}

export default function LabDracoCompression() {
  return React.createElement('div', { className: 'w-full space-y-4' },
    React.createElement('div', { className: 'bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700' },
      React.createElement('h3', { className: 'text-xl font-bold mb-4 flex items-center gap-2' },
        React.createElement('span', { className: 'material-symbols-outlined text-indigo-500' }, 'compress'),
        'DRACO Mesh Compression'
      ),
      React.createElement('div', { className: 'h-[400px] bg-slate-950 rounded-lg overflow-hidden relative' },
        React.createElement(Canvas, { camera: { position: [3, 3, 3], fov: 50 } },
          React.createElement('ambientLight', { intensity: 0.5 }),
          React.createElement('directionalLight', { position: [5, 5, 5], intensity: 1 }),
          React.createElement('mesh', null,
            React.createElement('torusKnotGeometry', { args: [1, 0.3, 128, 32] }),
            React.createElement('meshStandardMaterial', { color: '#667eea', roughness: 0.3, metalness: 0.5 })
          ),
          React.createElement(OrbitControls, { enableDamping: true })
        )
      )
    ),
    React.createElement('div', { className: 'grid grid-cols-3 gap-4' },
      React.createElement('div', { className: 'p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-center' },
        React.createElement('div', { className: 'text-2xl font-bold text-indigo-600' }, '~75%'),
        React.createElement('div', { className: 'text-sm text-gray-500' }, 'Size Reduction')
      ),
      React.createElement('div', { className: 'p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-center' },
        React.createElement('div', { className: 'text-2xl font-bold text-purple-600' }, '< 50ms'),
        React.createElement('div', { className: 'text-sm text-gray-500' }, 'Decode Time')
      ),
      React.createElement('div', { className: 'p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-center' },
        React.createElement('div', { className: 'text-2xl font-bold text-pink-600' }, 'WebGL 2.0'),
        React.createElement('div', { className: 'text-sm text-gray-500' }, 'Requirement')
      )
    )
  );
}


