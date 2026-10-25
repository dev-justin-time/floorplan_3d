import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

function InstancedFurniture({ count = 100 }) {
  const meshRef = useRef();
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  const positions = useMemo(() => {
    const temp = [];
    for (let i = 0; i < count; i++) {
      temp.push([
        (Math.random() - 0.5) * 20,
        0.5,
        (Math.random() - 0.5) * 20
      ]);
    }
    return temp;
  }, [count]);
  
  useFrame((state) => {
    if (meshRef.current) {
      positions.forEach((pos, i) => {
        dummy.position.set(...pos);
        dummy.rotation.y = state.clock.elapsedTime + i;
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      });
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
  });
  
  return React.createElement('instancedMesh', {
    ref: meshRef,
    args: [null, null, count],
    castShadow: true,
    receiveShadow: true
  },
    React.createElement('boxGeometry', { args: [0.5, 1, 0.5] }),
    React.createElement('meshStandardMaterial', { color: '#4299e1' })
  );
}

export default function LabInstancing() {
  const [count, setCount] = React.useState(100);
  
  return React.createElement('div', { className: 'bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700' },
    React.createElement('div', { className: 'flex items-center justify-between mb-4' },
      React.createElement('h3', { className: 'text-xl font-bold flex items-center gap-2' },
        React.createElement('span', { className: 'material-symbols-outlined text-cyan-500' }, 'auto_awesome'),
        'GPU Instancing'
      )
    ),
    React.createElement('div', { className: 'h-[400px] bg-slate-950 rounded-lg overflow-hidden relative' },
      React.createElement(Canvas, { 
        shadows: true,
        camera: { position: [15, 15, 15], fov: 50 }
      },
        React.createElement('ambientLight', { intensity: 0.3 }),
        React.createElement('directionalLight', { 
          position: [10, 10, 5], 
          intensity: 1,
          castShadow: true
        }),
        React.createElement(InstancedFurniture, { count }),
        React.createElement('mesh', { rotation: [-Math.PI / 2, 0, 0], receiveShadow: true },
          React.createElement('planeGeometry', { args: [50, 50] }),
          React.createElement('meshStandardMaterial', { color: '#2d3748' })
        ),
        React.createElement(OrbitControls, { enableDamping: true })
      ),
      React.createElement('div', { className: 'absolute bottom-4 left-4 bg-black/70 backdrop-blur text-white px-4 py-2 rounded-lg text-sm' },
        `${count} instances - Single draw call`
      )
    ),
    React.createElement('div', { className: 'mt-4' },
      React.createElement('label', { className: 'block text-sm font-medium mb-2' },
        `Instance Count: ${count}`
      ),
      React.createElement('input', {
        type: 'range',
        min: '10',
        max: '500',
        value: count,
        onChange: (e) => setCount(parseInt(e.target.value)),
        className: 'w-full accent-cyan-500'
      })
    )
  );
}


