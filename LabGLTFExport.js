import React, { useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Download } from 'lucide-react';

function ExportableScene() {
  const groupRef = useRef();
  
  return React.createElement('group', { ref: groupRef },
    // Sample geometry to export
    React.createElement('mesh', { position: [-2, 0.5, 0], castShadow: true },
      React.createElement('boxGeometry', { args: [1, 1, 1] }),
      React.createElement('meshStandardMaterial', { color: '#4299e1' })
    ),
    React.createElement('mesh', { position: [0, 0.5, 0], castShadow: true },
      React.createElement('sphereGeometry', { args: [0.5, 32, 32] }),
      React.createElement('meshStandardMaterial', { color: '#48bb78' })
    ),
    React.createElement('mesh', { position: [2, 0.5, 0], castShadow: true },
      React.createElement('cylinderGeometry', { args: [0.5, 0.5, 1, 32] }),
      React.createElement('meshStandardMaterial', { color: '#ed8936' })
    ),
    React.createElement('mesh', { rotation: [-Math.PI / 2, 0, 0], receiveShadow: true },
      React.createElement('planeGeometry', { args: [10, 10] }),
      React.createElement('meshStandardMaterial', { color: '#2d3748' })
    )
  );
}

export default function LabGLTFExport() {
  const sceneRef = useRef();
  const [exporting, setExporting] = useState(false);
  
  const handleExport = (binary = false) => {
    if (!sceneRef.current) return;
    
    setExporting(true);
    
    const exporter = new GLTFExporter();
    const options = {
      binary: binary,
      embedImages: true
    };
    
    exporter.parse(
      sceneRef.current,
      (result) => {
        const output = binary 
          ? result 
          : JSON.stringify(result, null, 2);
        
        const blob = binary
          ? new Blob([result], { type: 'application/octet-stream' })
          : new Blob([output], { type: 'application/json' });
        
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = binary ? 'scene.glb' : 'scene.gltf';
        link.click();
        URL.revokeObjectURL(url);
        
        setExporting(false);
      },
      (error) => {
        console.error('Export failed:', error);
        setExporting(false);
      },
      options
    );
  };
  
  return React.createElement('div', { className: 'w-full h-[600px] bg-slate-950 rounded-lg overflow-hidden relative' },
    React.createElement(Canvas, { 
      shadows: true, 
      camera: { position: [5, 5, 5], fov: 50 },
      ref: sceneRef
    },
      React.createElement('ambientLight', { intensity: 0.4 }),
      React.createElement('directionalLight', { 
        position: [5, 10, 5], 
        intensity: 1,
        castShadow: true
      }),
      React.createElement(ExportableScene),
      React.createElement(OrbitControls, { enableDamping: true })
    ),
    React.createElement('div', { className: 'absolute top-4 right-4 flex gap-2' },
      React.createElement('button', {
        onClick: () => handleExport(false),
        disabled: exporting,
        className: 'flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors'
      },
        React.createElement(Download, { className: 'w-4 h-4' }),
        exporting ? 'Exporting...' : 'GLTF'
      ),
      React.createElement('button', {
        onClick: () => handleExport(true),
        disabled: exporting,
        className: 'flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors'
      },
        React.createElement(Download, { className: 'w-4 h-4' }),
        exporting ? 'Exporting...' : 'GLB'
      )
    )
  );
}


