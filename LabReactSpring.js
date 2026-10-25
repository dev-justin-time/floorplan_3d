import React, { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useSpring, animated, config } from '@react-spring/three';

function AnimatedBox({ active }) {
  const { scale, rotation, color } = useSpring({
    scale: active ? 1.5 : 1,
    rotation: active ? [Math.PI / 4, Math.PI / 4, 0] : [0, 0, 0],
    color: active ? '#ec4899' : '#3b82f6',
    config: config.wobbly
  });
  
  return React.createElement(animated.mesh, {
    scale: scale,
    rotation: rotation,
    castShadow: true
  },
    React.createElement('boxGeometry', { args: [1, 1, 1] }),
    React.createElement(animated.meshStandardMaterial, { color: color })
  );
}

export default function LabReactSpring() {
  const [active, setActive] = useState(false);
  
  return React.createElement('div', { className: 'bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700' },
    React.createElement('div', { className: 'flex items-center justify-between mb-4' },
      React.createElement('h3', { className: 'text-xl font-bold flex items-center gap-2' },
        React.createElement('span', { className: 'material-symbols-outlined text-yellow-500' }, 'animation'),
        'React Spring Physics'
      )
    ),
    React.createElement('div', { className: 'h-[300px] bg-slate-950 rounded-lg overflow-hidden relative' },
      React.createElement(Canvas, { 
        shadows: true,
        camera: { position: [3, 3, 3], fov: 50 }
      },
        React.createElement('ambientLight', { intensity: 0.4 }),
        React.createElement('directionalLight', { 
          position: [5, 5, 5], 
          intensity: 1,
          castShadow: true
        }),
        React.createElement(AnimatedBox, { active }),
        React.createElement('mesh', { rotation: [-Math.PI / 2, 0, 0], receiveShadow: true, position: [0, -1, 0] },
          React.createElement('planeGeometry', { args: [10, 10] }),
          React.createElement('meshStandardMaterial', { color: '#1e293b' })
        ),
        React.createElement(OrbitControls, { enableDamping: true })
      )
    ),
    React.createElement('div', { className: 'mt-4 flex justify-center' },
      React.createElement('button', {
        onClick: () => setActive(!active),
        className: 'px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium transition-colors'
      }, active ? 'Deactivate' : 'Activate Animation')
    ),
    React.createElement('div', { className: 'mt-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm text-gray-600 dark:text-gray-400' },
      'Physics-based spring animations using react-spring/three for smooth, natural transitions'
    )
  );
}


