import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, ContactShadows, Environment, PresentationControls } from '@react-three/drei';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';

function ShakerModel({ rotation, scale, autoRotate }) {
  const { scene } = useGLTF('/shaker.glb');
  const meshRef = useRef();
  
  useFrame((state) => {
    if (meshRef.current && autoRotate) {
      meshRef.current.rotation.y += 0.01;
    }
  });
  
  return React.createElement('primitive', {
    ref: meshRef,
    object: scene.clone(),
    scale: scale,
    rotation: [rotation.x, rotation.y, rotation.z]
  });
}

export default function LabShaker3DViewer() {
  const [rotation, setRotation] = useState({ x: 0, y: 0, z: 0 });
  const [scale, setScale] = useState(1);
  const [autoRotate, setAutoRotate] = useState(false);
  
  const resetView = () => {
    setRotation({ x: 0, y: 0, z: 0 });
    setScale(1);
    setAutoRotate(false);
  };
  
  return React.createElement('div', { className: 'bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700' },
    React.createElement('div', { className: 'flex items-center justify-between mb-4' },
      React.createElement('h3', { className: 'text-xl font-bold flex items-center gap-2' },
        React.createElement('span', { className: 'material-symbols-outlined text-blue-500' }, 'view_in_ar'),
        '3D Product Viewer'
      ),
      React.createElement('div', { className: 'flex gap-2' },
        React.createElement('button', {
          onClick: () => setAutoRotate(!autoRotate),
          className: `px-3 py-1 rounded text-xs font-medium transition-colors ${autoRotate ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`
        }, 'Auto Rotate'),
        React.createElement('button', {
          onClick: resetView,
          className: 'p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors'
        }, React.createElement(RotateCcw, { className: 'w-4 h-4' }))
      )
    ),
    React.createElement('div', { className: 'h-[400px] bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-lg overflow-hidden relative' },
      React.createElement(Canvas, { 
        shadows: true,
        camera: { position: [0, 1.5, 3], fov: 50 }
      },
        React.createElement('ambientLight', { intensity: 0.5 }),
        React.createElement('spotLight', {
          position: [5, 5, 5],
          angle: 0.3,
          penumbra: 1,
          intensity: 1,
          castShadow: true
        }),
        React.createElement(PresentationControls, {
          global: true,
          rotation: [0, 0, 0],
          polar: [-Math.PI / 4, Math.PI / 4],
          azimuth: [-Math.PI / 2, Math.PI / 2]
        },
          React.createElement(ShakerModel, {
            rotation: rotation,
            scale: scale,
            autoRotate: autoRotate
          })
        ),
        React.createElement(ContactShadows, {
          position: [0, 0, 0],
          opacity: 0.4,
          scale: 5,
          blur: 2.5,
          far: 4
        }),
        React.createElement(Environment, { preset: 'sunset' })
      ),
      React.createElement('div', { className: 'absolute bottom-4 left-4 bg-black/60 backdrop-blur text-white px-3 py-1.5 rounded text-xs' },
        'Click and drag to rotate'
      )
    ),
    React.createElement('div', { className: 'mt-4 grid grid-cols-2 gap-4' },
      React.createElement('div', null,
        React.createElement('label', { className: 'block text-xs font-medium mb-2' }, 'Scale'),
        React.createElement('div', { className: 'flex items-center gap-2' },
          React.createElement('button', {
            onClick: () => setScale(Math.max(0.5, scale - 0.1)),
            className: 'p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded'
          }, React.createElement(ZoomOut, { className: 'w-4 h-4' })),
          React.createElement('input', {
            type: 'range',
            min: '0.5',
            max: '2',
            step: '0.1',
            value: scale,
            onChange: (e) => setScale(parseFloat(e.target.value)),
            className: 'flex-1 accent-blue-500'
          }),
          React.createElement('button', {
            onClick: () => setScale(Math.min(2, scale + 0.1)),
            className: 'p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded'
          }, React.createElement(ZoomIn, { className: 'w-4 h-4' }))
        )
      ),
      React.createElement('div', null,
        React.createElement('label', { className: 'block text-xs font-medium mb-2' }, 'Y Rotation'),
        React.createElement('input', {
          type: 'range',
          min: '0',
          max: `${Math.PI * 2}`,
          step: '0.1',
          value: rotation.y,
          onChange: (e) => setRotation({...rotation, y: parseFloat(e.target.value)}),
          className: 'w-full accent-blue-500'
        })
      )
    )
  );
}


