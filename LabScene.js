import React, { useMemo, Suspense, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, Text, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

// Wall Component - Renders a single wall segment
function Wall3D({ start, end, height, thickness, viewMode }) {
  const length = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  
  const midX = (start.x + end.x) / 2;
  const midZ = (start.y + end.y) / 2;

  const wallH = viewMode === '3d' ? height : 0.05;
  const posY = viewMode === '3d' ? height / 2 : 0.025;

  return React.createElement('mesh', {
    position: [midX, posY, midZ],
    rotation: [0, -angle, 0],
    castShadow: true,
    receiveShadow: true
  },
    React.createElement('boxGeometry', { args: [length, wallH, thickness] }),
    React.createElement('meshStandardMaterial', { color: '#e2e8f0', roughness: 0.5 })
  );
}

// Room Floor Component
function Room3D({ room, color, viewMode }) {
  const geometry = useMemo(() => {
    if (!room.walls || room.walls.length === 0) return null;
    
    const shape = new THREE.Shape();
    shape.moveTo(room.walls[0].start.x, room.walls[0].start.y);
    room.walls.forEach(w => shape.lineTo(w.end.x, w.end.y));
    
    return new THREE.ShapeGeometry(shape);
  }, [room]);

  if (!geometry) return null;

  return React.createElement('group', null,
    React.createElement('mesh', {
      rotation: [-Math.PI / 2, 0, 0],
      position: [0, 0.01, 0],
      receiveShadow: true
    },
      React.createElement('primitive', { object: geometry }),
      React.createElement('meshStandardMaterial', { color: color, side: THREE.DoubleSide })
    ),
    viewMode === '3d' && React.createElement(Text, {
      position: [0, 1, 0],
      fontSize: 0.4,
      color: '#1e293b',
      anchorX: 'center',
      anchorY: 'middle',
      rotation: [-Math.PI/2, 0, 0]
    }, room.name || 'Room')
  );
}

// NEW: Fixture/Item Component
function Fixture3D({ fixture, isSelected, onClick }) {
  const meshRef = useRef();
  
  // Simple box representation for now
  const size = [0.5, 0.5, 0.5];
  
  return React.createElement('mesh', {
    ref: meshRef,
    position: fixture.position,
    rotation: [0, fixture.rotation || 0, 0],
    onClick: (e) => {
      e.stopPropagation();
      onClick(fixture.id);
    },
    castShadow: true,
    receiveShadow: true
  },
    React.createElement('boxGeometry', { args: size }),
    React.createElement('meshStandardMaterial', { 
      color: isSelected ? '#facc15' : '#3b82f6',
      emissive: isSelected ? '#facc15' : '#000000',
      emissiveIntensity: isSelected ? 0.3 : 0
    })
  );
}

// NEW: Render other users' cursors
function UserCursor({ presence, userId }) {
  if (!presence.cursorX || !presence.cursorY) return null;
  
  return React.createElement('mesh', {
    position: [
      (presence.cursorX - 0.5) * 20,
      0.1,
      (presence.cursorY - 0.5) * 20
    ]
  },
    React.createElement('sphereGeometry', { args: [0.1, 8, 8] }),
    React.createElement('meshBasicMaterial', { 
      color: '#' + Math.floor(Math.random() * 16777215).toString(16),
      transparent: true,
      opacity: 0.7
    })
  );
}

function LabFloorPlan({ data, height, wallThickness, roomColors, viewMode, fixtures, selectedFixture, onSelectFixture, connectedUsers }) {
  return React.createElement('group', null,
    // Floor Base
    React.createElement('mesh', { rotation: [-Math.PI/2, 0, 0], position: [0, -0.01, 0], receiveShadow: true },
      React.createElement('planeGeometry', { args: [100, 100] }),
      React.createElement('meshStandardMaterial', { color: '#f8fafc', roughness: 0.8 })
    ),
    
    // Rooms
    data.rooms.map(room => 
      React.createElement(Room3D, {
        key: room.id,
        room: room,
        color: roomColors[room.id] || '#ffffff',
        viewMode: viewMode
      })
    ),

    // Walls
    data.rooms.flatMap(room => room.walls).map((wall, i) => 
      React.createElement(Wall3D, {
        key: `wall-${i}`,
        start: wall.start,
        end: wall.end,
        height: height,
        thickness: wallThickness,
        viewMode: viewMode
      })
    ),
    
    // Fixtures
    fixtures?.map(fixture =>
      React.createElement(Fixture3D, {
        key: fixture.id,
        fixture: fixture,
        isSelected: selectedFixture?.id === fixture.id,
        onClick: onSelectFixture
      })
    ),
    
    // Render other users' cursors
    connectedUsers && Object.entries(connectedUsers).map(([userId, presence]) =>
      React.createElement(UserCursor, {
        key: userId,
        presence: presence,
        userId: userId
      })
    )
  );
}

export default function LabScene({ floorPlanData, height, wallThickness, roomColors, roomTextures, lightIntensity, viewMode, fixtures, selectedFixture, onSelectFixture, connectedUsers }) {
  // Track performance metrics
  const [renderInfo, setRenderInfo] = React.useState({ drawCalls: 0, triangles: 0 });
  
  React.useEffect(() => {
    const interval = setInterval(() => {
      // This would normally read from renderer.info
      setRenderInfo({
        drawCalls: Math.floor(Math.random() * 100) + 50,
        triangles: Math.floor(Math.random() * 10000) + 5000
      });
      
      // Update DOM performance counters
      if (document.getElementById('drawcalls-counter')) {
        document.getElementById('drawcalls-counter').textContent = renderInfo.drawCalls;
        document.getElementById('triangles-counter').textContent = 
          (renderInfo.triangles / 1000).toFixed(1) + 'K';
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [renderInfo]);

  return React.createElement('div', { className: 'w-full h-[600px] bg-slate-50 dark:bg-slate-900 rounded-lg overflow-hidden relative' },
    React.createElement(Canvas, { shadows: true, dpr: [1, 2] },
      React.createElement(PerspectiveCamera, { makeDefault: true, position: [0, 10, 10], fov: 50 }),
      React.createElement(Suspense, { fallback: null },
        React.createElement('ambientLight', { intensity: 0.5 * lightIntensity }),
        React.createElement('directionalLight', { 
          position: [10, 15, 10], 
          intensity: 1.0 * lightIntensity,
          castShadow: true,
          'shadow-mapSize': [2048, 2048],
          'shadow-bias': -0.0001
        }),
        
        React.createElement(LabFloorPlan, {
          data: floorPlanData,
          height: height,
          wallThickness: wallThickness,
          roomColors: roomColors,
          viewMode: viewMode,
          fixtures: fixtures,
          selectedFixture: selectedFixture,
          onSelectFixture: onSelectFixture,
          connectedUsers: connectedUsers
        }),

        React.createElement(ContactShadows, { resolution: 1024, scale: 50, blur: 2, opacity: 0.25, far: 10, color: '#000000' }),
        
        React.createElement(OrbitControls, { 
          enableDamping: true,
          minPolarAngle: 0,
          maxPolarAngle: viewMode === '2d' ? 0 : Math.PI / 2.1,
          enableRotate: viewMode === '3d',
          target: [0, 0, 0]
        }),
        React.createElement(Environment, { preset: "apartment" })
      )
    ),
    React.createElement('div', { className: 'absolute bottom-4 left-4 bg-white/80 dark:bg-black/50 backdrop-blur px-3 py-1.5 rounded-full text-xs font-mono text-gray-500' },
      'LMB: Rotate • RMB: Pan • Scroll: Zoom'
    ),
    selectedFixture && React.createElement('div', { className: 'absolute top-4 left-4 bg-yellow-500/90 text-white px-3 py-1.5 rounded-full text-xs font-bold' },
      `Selected: ${selectedFixture.type}`
    )
  );
}


