import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, EffectComposer, Bloom, DepthOfField, Vignette } from '@react-three/drei';

function RotatingShaker() {
  const { scene } = useGLTF('/shaker.glb');
  const meshRef = useRef();
  
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.01;
    }
  });
  
  return React.createElement('primitive', {
    ref: meshRef,
    object: scene.clone(),
    scale: 1.5
  });
}

export default function LabPostProcessing() {
  const [bloomEnabled, setBloomEnabled] = React.useState(true);
  const [dofEnabled, setDofEnabled] = React.useState(false);
  const [vignetteEnabled, setVignetteEnabled] = React.useState(false);
  
  return React.createElement('div', { className: 'bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700' },
    React.createElement('div', { className: 'flex items-center justify-between mb-4' },
      React.createElement('h3', { className: 'text-xl font-bold flex items-center gap-2' },
        React.createElement('span', { className: 'material-symbols-outlined text-pink-500' }, 'auto_fix_high'),
        'Post-Processing Effects'
      )
    ),
    React.createElement('div', { className: 'h-[400px] bg-slate-950 rounded-lg overflow-hidden relative' },
      React.createElement(Canvas, { 
        shadows: true,
        camera: { position: [0, 2, 5], fov: 50 }
      },
        React.createElement('ambientLight', { intensity: 0.3 }),
        React.createElement('spotLight', {
          position: [5, 5, 5],
          intensity: 1.5,
          castShadow: true
        }),
        React.createElement(RotatingShaker),
        React.createElement('mesh', { rotation: [-Math.PI / 2, 0, 0], receiveShadow: true, position: [0, -1, 0] },
          React.createElement('planeGeometry', { args: [10, 10] }),
          React.createElement('meshStandardMaterial', { color: '#1a202c' })
        ),
        React.createElement(EffectComposer, null,
          bloomEnabled && React.createElement(Bloom, {
            luminanceThreshold: 0.2,
            luminanceSmoothing: 0.9,
            intensity: 1.5
          }),
          dofEnabled && React.createElement(DepthOfField, {
            focusDistance: 0,
            focalLength: 0.02,
            bokehScale: 2
          }),
          vignetteEnabled && React.createElement(Vignette, {
            offset: 0.3,
            darkness: 0.5
          })
        ),
        React.createElement(OrbitControls, { enableDamping: true })
      )
    ),
    React.createElement('div', { className: 'mt-4 grid grid-cols-3 gap-2' },
      React.createElement('label', { className: 'flex items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-900 cursor-pointer' },
        React.createElement('input', {
          type: 'checkbox',
          checked: bloomEnabled,
          onChange: (e) => setBloomEnabled(e.target.checked),
          className: 'rounded'
        }),
        React.createElement('span', { className: 'text-sm' }, 'Bloom')
      ),
      React.createElement('label', { className: 'flex items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-900 cursor-pointer' },
        React.createElement('input', {
          type: 'checkbox',
          checked: dofEnabled,
          onChange: (e) => setDofEnabled(e.target.checked),
          className: 'rounded'
        }),
        React.createElement('span', { className: 'text-sm' }, 'Depth of Field')
      ),
      React.createElement('label', { className: 'flex items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-900 cursor-pointer' },
        React.createElement('input', {
          type: 'checkbox',
          checked: vignetteEnabled,
          onChange: (e) => setVignetteEnabled(e.target.checked),
          className: 'rounded'
        }),
        React.createElement('span', { className: 'text-sm' }, 'Vignette')
      )
    )
  );
}


