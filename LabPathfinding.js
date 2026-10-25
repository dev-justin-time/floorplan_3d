import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Sphere, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Pathfinder } from 'three-pathfinding';

// Pathfinding Demonstration Component
function PathfindingDemo() {
  const [path, setPath] = useState([]);
  const [navMesh, setNavMesh] = useState(null);
  const pathfinder = useRef(new Pathfinder());
  const agentRef = useRef();
  const [currentPoint, setCurrentPoint] = useState(0);
  
  useEffect(() => {
    // Create simple navmesh from floor geometry
    const geometry = new THREE.BoxGeometry(10, 0.1, 10);
    const mesh = new THREE.Mesh(geometry);
    mesh.position.set(0, 0, 0);
    
    const zone = 'level1';
    pathfinder.current.setZoneData(zone, Pathfinder.createZone(geometry));
    setNavMesh(mesh);
  }, []);
  
  const calculatePath = (start, end) => {
    if (!navMesh) return;
    
    const zone = 'level1';
    const groupID = pathfinder.current.getGroup(zone, start);
    const foundPath = pathfinder.current.findPath(start, end, zone, groupID);
    
    if (foundPath && foundPath.length > 0) {
      setPath(foundPath);
      setCurrentPoint(0);
    }
  };
  
  useFrame(() => {
    if (agentRef.current && path.length > 0 && currentPoint < path.length) {
      const target = path[currentPoint];
      const current = agentRef.current.position;
      
      const direction = new THREE.Vector3().subVectors(target, current);
      const distance = direction.length();
      
      if (distance < 0.1) {
        setCurrentPoint(prev => prev + 1);
      } else {
        direction.normalize().multiplyScalar(0.05);
        agentRef.current.position.add(direction);
      }
    }
  });
  
  return React.createElement('group', null,
    // Floor
    React.createElement('mesh', { 
      rotation: [-Math.PI / 2, 0, 0], 
      receiveShadow: true,
      onClick: (e) => {
        e.stopPropagation();
        const start = agentRef.current ? agentRef.current.position.clone() : new THREE.Vector3(0, 0.5, 0);
        calculatePath(start, e.point);
      }
    },
      React.createElement('planeGeometry', { args: [10, 10] }),
      React.createElement('meshStandardMaterial', { color: '#2d3748', roughness: 0.8 })
    ),
    
    // Agent
    React.createElement('mesh', { ref: agentRef, position: [0, 0.5, 0], castShadow: true },
      React.createElement('sphereGeometry', { args: [0.3, 16, 16] }),
      React.createElement('meshStandardMaterial', { color: '#48bb78', emissive: '#48bb78', emissiveIntensity: 0.2 })
    ),
    
    // Path visualization
    path.length > 0 && React.createElement(Line, {
      points: path,
      color: '#f6ad55',
      lineWidth: 3
    }),
    
    // Path points
    path.map((point, i) =>
      React.createElement('mesh', { key: i, position: point },
        React.createElement('sphereGeometry', { args: [0.1, 8, 8] }),
        React.createElement('meshBasicMaterial', { color: '#ed8936' })
      )
    )
  );
}

export default function LabPathfinding() {
  return React.createElement('div', { className: 'w-full h-[600px] bg-slate-950 rounded-lg overflow-hidden relative' },
    React.createElement(Canvas, { shadows: true, camera: { position: [8, 8, 8], fov: 50 } },
      React.createElement('ambientLight', { intensity: 0.3 }),
      React.createElement('directionalLight', { 
        position: [5, 10, 5], 
        intensity: 0.8,
        castShadow: true
      }),
      React.createElement(PathfindingDemo),
      React.createElement(OrbitControls, { enableDamping: true })
    ),
    React.createElement('div', { className: 'absolute bottom-4 left-4 bg-black/70 backdrop-blur text-white px-4 py-2 rounded-lg text-sm' },
      'Click on the floor to set a destination'
    )
  );
}


