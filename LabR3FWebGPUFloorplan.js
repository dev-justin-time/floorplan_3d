import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';

// Simple hard-coded floorplan (rectangle room + inner wall) rendered via R3F
const FLOOR_WALLS = [
  { start: { x: -4, y: -3 }, end: { x: 4, y: -3 } },
  { start: { x: 4, y: -3 }, end: { x: 4, y: 3 } },
  { start: { x: 4, y: 3 }, end: { x: -4, y: 3 } },
  { start: { x: -4, y: 3 }, end: { x: -4, y: -3 } },
  // inner divider
  { start: { x: 0, y: -3 }, end: { x: 0, y: 3 } }
];

function R3FWall({ wall, height = 2.7, thickness = 0.15 }) {
  const { length, position, angle } = useMemo(() => {
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.y - wall.start.y;
    const len = Math.hypot(dx, dz);
    return {
      length: len,
      position: [
        (wall.start.x + wall.end.x) / 2,
        height / 2,
        (wall.start.y + wall.end.y) / 2
      ],
      angle: Math.atan2(dz, dx)
    };
  }, [wall, height]);

  return React.createElement(
    'mesh',
    { position, rotation: [0, angle, 0], castShadow: true, receiveShadow: true },
    React.createElement('boxGeometry', { args: [length, height, thickness] }),
    React.createElement('meshStandardMaterial', {
      color: '#e2e8f0',
      roughness: 0.55,
      metalness: 0.05
    })
  );
}

function R3FFloorplanScene() {
  return React.createElement(
    'group',
    null,
    // Ground plane
    React.createElement(
      'mesh',
      { rotation: [-Math.PI / 2, 0, 0], position: [0, 0, 0], receiveShadow: true },
      React.createElement('planeGeometry', { args: [30, 30] }),
      React.createElement('meshStandardMaterial', { color: '#0f172a', roughness: 1 })
    ),
    // Walls
    FLOOR_WALLS.map((w, i) =>
      React.createElement(R3FWall, { key: i, wall: w })
    ),
    // A simple fixture box to hint at furniture
    React.createElement(
      'mesh',
      { position: [1.5, 0.4, 1.5], castShadow: true, receiveShadow: true },
      React.createElement('boxGeometry', { args: [1.2, 0.8, 0.7] }),
      React.createElement('meshStandardMaterial', { color: '#38bdf8', roughness: 0.3, metalness: 0.2 })
    )
  );
}

export default function LabR3FWebGPUFloorplan() {
  return React.createElement(
    'div',
    { className: 'w-full h-[260px] bg-slate-950 rounded-lg overflow-hidden relative' },
    React.createElement(
      Canvas,
      {
        shadows: true,
        camera: { position: [6, 6, 6], fov: 45 }
      },
      React.createElement('ambientLight', { intensity: 0.4 }),
      React.createElement('directionalLight', {
        position: [5, 8, 5],
        intensity: 0.9,
        castShadow: true,
        'shadow-mapSize-width': 1024,
        'shadow-mapSize-height': 1024
      }),
      React.createElement(R3FFloorplanScene, null),
      React.createElement(OrbitControls, {
        enableDamping: true,
        maxPolarAngle: Math.PI / 2.1,
        minPolarAngle: 0
      }),
      React.createElement(Environment, { preset: 'city' })
    ),
    React.createElement(
      'div',
      { className: 'absolute top-3 right-3 bg-black/60 text-white text-[11px] px-2 py-1.5 rounded-full' },
      'React Three Fiber • WebGL backend'
    )
  );
}


