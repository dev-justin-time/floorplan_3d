import React, { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

function PhysicsShaker({ isShaking, intensity }) {
  const { scene } = useGLTF('/shaker.glb');
  const meshRef = useRef();
  const [velocity, setVelocity] = useState(new THREE.Vector3());
  const [position, setPosition] = useState(new THREE.Vector3(0, 0, 0));
  
  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    if (isShaking) {
      // Apply random forces for shaking effect
      const force = new THREE.Vector3(
        (Math.random() - 0.5) * intensity,
        (Math.random() - 0.5) * intensity,
        (Math.random() - 0.5) * intensity
      );
      
      velocity.add(force.multiplyScalar(delta));
      position.add(velocity.clone().multiplyScalar(delta));
      
      // Apply damping
      velocity.multiplyScalar(0.95);
      
      // Constrain position
      position.x = Math.max(-0.5, Math.min(0.5, position.x));
      position.y = Math.max(-0.2, Math.min(0.2, position.y));
      position.z = Math.max(-0.5, Math.min(0.5, position.z));
      
      meshRef.current.position.copy(position);
      
      // Add rotation shake
      meshRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 20) * 0.1 * intensity;
    } else {
      // Return to rest position
      position.lerp(new THREE.Vector3(0, 0, 0), 0.1);
      velocity.multiplyScalar(0.9);
      meshRef.current.position.copy(position);
      meshRef.current.rotation.z *= 0.9;
    }
  });
  
  return React.createElement('primitive', {
    ref: meshRef,
    object: scene.clone(),
    scale: 1
  });
}

export default function LabShakerPhysics() {
  const [isShaking, setIsShaking] = useState(false);
  const [intensity, setIntensity] = useState(0.5);
  
  return React.createElement('div', { className: 'bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700' },
    React.createElement('div', { className: 'flex items-center justify-between mb-4' },
      React.createElement('h3', { className: 'text-xl font-bold flex items-center gap-2' },
        React.createElement('span', { className: 'material-symbols-outlined text-purple-500' }, 'graphic_eq'),
        'Physics Simulation'
      )
    ),
    React.createElement('div', { className: 'h-[400px] bg-slate-950 rounded-lg overflow-hidden relative' },
      React.createElement(Canvas, {
        shadows: true,
        camera: { position: [0, 1, 3], fov: 50 }
      },
        React.createElement('ambientLight', { intensity: 0.4 }),
        React.createElement('spotLight', {
          position: [3, 5, 3],
          angle: 0.3,
          penumbra: 1,
          intensity: 1,
          castShadow: true
        }),
        React.createElement(PhysicsShaker, {
          isShaking: isShaking,
          intensity: intensity
        }),
        React.createElement(ContactShadows, {
          position: [0, 0, 0],
          opacity: 0.5,
          scale: 3,
          blur: 2
        }),
        React.createElement(OrbitControls, { enableDamping: true })
      )
    ),
    React.createElement('div', { className: 'mt-4 space-y-4' },
      React.createElement('div', null,
        React.createElement('label', { className: 'block text-xs font-medium mb-2' }, 
          `Shake Intensity: ${Math.round(intensity * 100)}%`
        ),
        React.createElement('input', {
          type: 'range',
          min: '0',
          max: '1',
          step: '0.1',
          value: intensity,
          onChange: (e) => setIntensity(parseFloat(e.target.value)),
          className: 'w-full accent-purple-500'
        })
      ),
      React.createElement('button', {
        onClick: () => setIsShaking(!isShaking),
        className: `w-full px-4 py-3 rounded-lg font-medium transition-all ${isShaking ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-purple-500 hover:bg-purple-600 text-white'}`
      }, isShaking ? 'Stop Shaking' : 'Start Shaking')
    )
  );
}


