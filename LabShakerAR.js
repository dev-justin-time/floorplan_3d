import React, { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, ContactShadows, PerspectiveCamera } from '@react-three/drei';
import { ArrowLeftRight, ArrowUpDown, RotateCw } from 'lucide-react';

function PlaceableShaker({ position, rotation, scale }) {
  const { scene } = useGLTF('/shaker.glb');
  const meshRef = useRef();
  
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.005;
    }
  });
  
  return React.createElement('group', {
    position: position,
    rotation: [0, rotation, 0],
    scale: scale
  },
    React.createElement('primitive', {
      ref: meshRef,
      object: scene.clone()
    })
  );
}

export default function LabShakerAR() {
  const [position, setPosition] = useState([0, 0, 0]);
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);
  const [surfaceType, setSurfaceType] = useState('table');
  
  const surfaces = {
    table: { color: '#8b4513', roughness: 0.6 },
    counter: { color: '#d3d3d3', roughness: 0.3 },
    shelf: { color: '#deb887', roughness: 0.7 }
  };
  
  return React.createElement('div', { className: 'bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700' },
    React.createElement('div', { className: 'flex items-center justify-between mb-4' },
      React.createElement('h3', { className: 'text-xl font-bold flex items-center gap-2' },
        React.createElement('span', { className: 'material-symbols-outlined text-green-500' }, 'deployed_code'),
        'AR Placement Preview'
      )
    ),
    React.createElement('div', { className: 'h-[400px] bg-gradient-to-b from-sky-200 to-slate-100 dark:from-slate-800 dark:to-slate-900 rounded-lg overflow-hidden relative' },
      React.createElement(Canvas, { shadows: true },
        React.createElement(PerspectiveCamera, {
          makeDefault: true,
          position: [0, 2, 4],
          fov: 50
        }),
        React.createElement('ambientLight', { intensity: 0.6 }),
        React.createElement('directionalLight', {
          position: [5, 5, 5],
          intensity: 0.8,
          castShadow: true
        }),
        React.createElement(PlaceableShaker, {
          position: position,
          rotation: rotation,
          scale: scale
        }),
        React.createElement('mesh', {
          rotation: [-Math.PI / 2, 0, 0],
          position: [0, 0, 0],
          receiveShadow: true
        },
          React.createElement('planeGeometry', { args: [10, 10] }),
          React.createElement('meshStandardMaterial', {
            color: surfaces[surfaceType].color,
            roughness: surfaces[surfaceType].roughness
          })
        ),
        React.createElement(ContactShadows, {
          position: [0, 0.01, 0],
          opacity: 0.4,
          scale: 5,
          blur: 2
        })
      ),
      React.createElement('div', { className: 'absolute top-4 left-4 bg-black/70 backdrop-blur text-white px-3 py-1.5 rounded text-xs' },
        'Surface: ', surfaceType.charAt(0).toUpperCase() + surfaceType.slice(1)
      )
    ),
    React.createElement('div', { className: 'mt-4 space-y-4' },
      React.createElement('div', { className: 'flex gap-2' },
        ['table', 'counter', 'shelf'].map(type =>
          React.createElement('button', {
            key: type,
            onClick: () => setSurfaceType(type),
            className: `flex-1 px-3 py-2 rounded text-xs font-medium transition-colors ${surfaceType === type ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`
          }, type.charAt(0).toUpperCase() + type.slice(1))
        )
      ),
      React.createElement('div', { className: 'grid grid-cols-3 gap-2' },
        React.createElement('button', {
          onClick: () => setPosition([position[0] - 0.2, position[1], position[2]]),
          className: 'p-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded transition-colors flex items-center justify-center gap-1'
        },
          React.createElement(ArrowLeftRight, { className: 'w-4 h-4' }),
          React.createElement('span', { className: 'text-xs' }, 'Left')
        ),
        React.createElement('button', {
          onClick: () => setRotation(rotation + Math.PI / 4),
          className: 'p-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded transition-colors flex items-center justify-center gap-1'
        },
          React.createElement(RotateCw, { className: 'w-4 h-4' }),
          React.createElement('span', { className: 'text-xs' }, 'Rotate')
        ),
        React.createElement('button', {
          onClick: () => setPosition([position[0] + 0.2, position[1], position[2]]),
          className: 'p-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded transition-colors flex items-center justify-center gap-1'
        },
          React.createElement(ArrowLeftRight, { className: 'w-4 h-4' }),
          React.createElement('span', { className: 'text-xs' }, 'Right')
        )
      ),
      React.createElement('div', null,
        React.createElement('label', { className: 'block text-xs font-medium mb-2' }, 
          `Scale: ${Math.round(scale * 100)}%`
        ),
        React.createElement('input', {
          type: 'range',
          min: '0.5',
          max: '2',
          step: '0.1',
          value: scale,
          onChange: (e) => setScale(parseFloat(e.target.value)),
          className: 'w-full accent-green-500'
        })
      )
    )
  );
}


