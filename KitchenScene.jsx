import React, { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { 
  OrbitControls, 
  Box, 
  Environment, 
  ContactShadows, 
  Grid,
  PerspectiveCamera
} from '@react-three/drei';
import Cabinet from './Cabinet';
import Wall from './Wall';

/**
 * KitchenScene Component
 * Renders the 3D environment, lighting, room boundaries, and interactive cabinets.
 * 
 * @param {Array} cabinets - Array of cabinet objects { id, position, size, color, name }
 * @param {string|null} selectedCabinet - ID of the currently selected cabinet
 * @param {Function} onSelectCabinet - Callback when a cabinet is clicked
 * @param {boolean} showLabels - Toggle visibility of 3D text labels
 * @param {Function} onControlsRef - Ref callback to access OrbitControls externally
 * @param {Object} room - Room dimensions { width, depth, height }
 */
export default function KitchenScene({ 
  cabinets = [], 
  selectedCabinet = null, 
  onSelectCabinet = () => {}, 
  showLabels = false, 
  onControlsRef, 
  room = { width: 20, depth: 12, height: 6 } 
}) {
  // Destructure safely with fallbacks
  const rw = Math.max(4, room?.width ?? 20);
  const rd = Math.max(4, room?.depth ?? 12);
  const rh = Math.max(4, room?.height ?? 6);

  // Memoize walls to prevent unnecessary re-renders when cabinets update
  const walls = useMemo(() => [
    { id: 'lw', position: [-rw / 2, rh / 2, 0], size: [0.2, rh, rd], name: 'Left Wall' },
    { id: 'rw', position: [rw / 2, rh / 2, 0], size: [0.2, rh, rd], name: 'Right Wall' },
    { id: 'bw', position: [0, rh / 2, -rd / 2], size: [rw, rh, 0.2], name: 'Back Wall' },
    // Optional: Add a front wall with a cutout, or leave open for camera viewing
  ], [rw, rd, rh]);

  return (
    <>
      {/* 1. Declarative Camera Setup (Replaces manual useEffect camera positioning) */}
      <PerspectiveCamera 
        makeDefault 
        position={[8, 6, 12]} 
        fov={50} 
      />

      {/* 2. Advanced Lighting & Environment (Crucial for realistic kitchen materials) */}
      <ambientLight intensity={0.4} />
      <directionalLight 
        position={[10, 15, 10]} 
        intensity={1.2} 
        castShadow 
        shadow-mapSize={[2048, 2048]} 
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      {/* HDRI Environment provides realistic reflections on glossy cabinet surfaces */}
      <Environment preset="apartment" background={false} />

      {/* 3. Floor */}
      <Box args={[rw, 0.1, rd]} position={[0, -0.05, 0]} receiveShadow>
        <meshStandardMaterial color="#f5f5f5" roughness={0.8} metalness={0.1} />
      </Box>

      {/* 4. Spatial Grid (Helps users orient themselves in 3D space) */}
      <Grid 
        position={[0, 0.01, 0]} 
        args={[rw, rd]} 
        cellSize={1} 
        cellThickness={0.5} 
        cellColor="#6f6f6f" 
        sectionSize={2} 
        sectionThickness={1} 
        sectionColor="#4a4a4a" 
        fadeDistance={30} 
        fadeStrength={1} 
        followCamera={false} 
        infiniteGrid={false} 
      />

      {/* 5. Walls */}
      {walls.map((wall) => (
        <Wall 
          key={wall.id}
          position={wall.position}
          size={wall.size}
          name={wall.name}
          showLabels={showLabels}
        />
      ))}

      {/* 6. Cabinets */}
      {cabinets.map((cabinet) => (
        <Cabinet
          key={cabinet.id}
          position={cabinet.position}
          size={cabinet.size}
          color={cabinet.color}
          name={cabinet.name}
          isSelected={selectedCabinet === cabinet.id}
          onClick={() => onSelectCabinet(cabinet.id)}
          showLabels={showLabels}
        />
      ))}

      {/* 7. Grounding Shadows (Makes objects feel like they are resting on the floor) */}
      <ContactShadows 
        position={[0, 0.01, 0]} 
        opacity={0.4} 
        scale={40} 
        blur={2} 
        far={4} 
        resolution={1024} 
        color="#000000" 
      />

      {/* 8. Interactive Controls */}
      <OrbitControls 
        ref={onControlsRef}
        makeDefault // Ensures this is the primary control system for the canvas
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={2}
        maxDistance={30}
        maxPolarAngle={Math.PI / 2 - 0.05} // Prevent camera from going below the floor
      />
    </>
  );
}