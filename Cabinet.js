import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Text, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Merlot Catalog: Defines programmatic cabinet configurations based on SKU.
 * This allows a single component to render base cabinets, wall cabinets, 
 * drawer banks, and sink bases dynamically based on dimensions and SKU.
 */
const MERLOT_CATALOG = {
  'MERLOT-B30': { type: 'base', doors: 2, drawers: 0, toeKick: 0.3, shelf: false },
  'MERLOT-B36': { type: 'base', doors: 2, drawers: 0, toeKick: 0.3, shelf: false }, // Sink base
  'MERLOT-DB30': { type: 'base', doors: 0, drawers: 3, toeKick: 0.3, shelf: false },
  'MERLOT-W30': { type: 'wall', doors: 2, drawers: 0, toeKick: 0, shelf: true },
  'MERLOT-W36': { type: 'wall', doors: 2, drawers: 0, toeKick: 0, shelf: true },
};

export default function Cabinet({ 
  position, 
  size, 
  color, 
  name, 
  sku = 'MERLOT-B30', 
  isSelected, 
  onClick, 
  showLabels 
}) {
  const groupRef = useRef();
  const meshRef = useRef();
  
  // Resolve catalog data, fallback to a standard 2-door base cabinet
  const config = useMemo(() => MERLOT_CATALOG[sku] || MERLOT_CATALOG['MERLOT-B30'], [sku]);
  
  const [width, height, depth] = size;
  const isBase = config.type === 'base';
  const bodyHeight = height - config.toeKick;
  const doorGap = 0.02;
  const handleOffset = 0.03;

  // Subtle, professional selection animation (gentle float + scale)
  useFrame((state) => {
    if (isSelected && groupRef.current) {
      const t = state.clock.elapsedTime;
      groupRef.current.position.y = position[1] + Math.sin(t * 3) * 0.02;
      groupRef.current.scale.setScalar(1 + Math.sin(t * 3) * 0.01);
    } else if (groupRef.current) {
      // Smoothly return to original position/scale
      groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, position[1], 0.1);
      groupRef.current.scale.x = THREE.MathUtils.lerp(groupRef.current.scale.x, 1, 0.1);
      groupRef.current.scale.y = THREE.MathUtils.lerp(groupRef.current.scale.y, 1, 0.1);
      groupRef.current.scale.z = THREE.MathUtils.lerp(groupRef.current.scale.z, 1, 0.1);
    }
  });

  // --- Programmatic Geometry Generators ---

  const renderDoors = () => {
    if (config.doors === 0) return null;
    const doorWidth = (width - (doorGap * (config.doors + 1))) / config.doors;
    const doorHeight = bodyHeight - (doorGap * 2);
    const doorDepth = 0.04; // Slight protrusion for shaker-style look

    const doors = [];
    for (let i = 0; i < config.doors; i++) {
      const x = -width / 2 + doorGap + (doorWidth / 2) + (i * (doorWidth + doorGap));
      const y = config.toeKick + (doorHeight / 2) + doorGap;
      
      doors.push(
        <group key={`door-${i}`} position={[x, y, depth / 2 + doorDepth / 2]}>
          {/* Door Panel */}
          <RoundedBox args={[doorWidth, doorHeight, doorDepth]} radius={0.01} smoothness={4} castShadow receiveShadow>
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.05} />
          </RoundedBox>
          {/* Shaker Style Inset (Visual Detail) */}
          <Box args={[doorWidth - 0.08, doorHeight - 0.08, 0.01]} position={[0, 0, doorDepth / 2 + 0.005]}>
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.05} />
          </Box>
          {/* Handle */}
          <mesh position={[doorWidth / 2 - 0.15, 0, doorDepth / 2 + 0.02]} castShadow>
            <cylinderGeometry args={[0.015, 0.015, 0.3, 8]} />
            <mesh rotation={[0, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#C0C0C0" roughness={0.2} metalness={0.9} />
          </mesh>
        </group>
      );
    }
    return doors;
  };

  const renderDrawers = () => {
    if (config.drawers === 0) return null;
    const drawerHeight = (bodyHeight - (doorGap * (config.drawers + 1))) / config.drawers;
    const drawerWidth = width - (doorGap * 2);
    const drawerDepth = 0.04;

    const drawers = [];
    for (let i = 0; i < config.drawers; i++) {
      const x = 0;
      const y = config.toeKick + drawerHeight / 2 + doorGap + (i * (drawerHeight + doorGap));
      
      drawers.push(
        <group key={`drawer-${i}`} position={[x, y, depth / 2 + drawerDepth / 2]}>
          {/* Drawer Front */}
          <RoundedBox args={[drawerWidth, drawerHeight, drawerDepth]} radius={0.01} smoothness={4} castShadow receiveShadow>
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.05} />
          </RoundedBox>
          {/* Handle (Centered for drawers) */}
          <mesh position={[0, 0, drawerDepth / 2 + 0.02]} castShadow>
            <boxGeometry args={[0.2, 0.03, 0.03]} />
            <meshStandardMaterial color="#C0C0C0" roughness={0.2} metalness={0.9} />
          </mesh>
        </group>
      );
    }
    return drawers;
  };

  return (
    <group 
      ref={groupRef} 
      position={position} 
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'auto')}
    >
      {/* 1. Main Cabinet Carcass (The Box) */}
      <Box ref={meshRef} args={[width, bodyHeight, depth]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} />
      </Box>

      {/* 2. Toe Kick (Only for Base Cabinets) */}
      {isBase && config.toeKick > 0 && (
        <Box 
          args={[width - 0.1, config.toeKick, depth - 0.1]} 
          position={[0, config.toeKick / 2, 0.05]} 
          castShadow 
          receiveShadow
        >
          <meshStandardMaterial color="#1a1a1a" roughness={0.9} metalness={0.1} />
        </Box>
      )}

      {/* 3. Interior Shelf (If specified in catalog) */}
      {config.shelf && (
        <Box 
          args={[width - 0.04, 0.02, depth - 0.04]} 
          position={[0, height / 2, 0]} 
          receiveShadow
        >
          <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} />
        </Box>
      )}

      {/* 4. Programmatic Doors & Drawers */}
      {renderDoors()}
      {renderDrawers()}

      {/* 5. Selection Highlight Ring (Visible only when selected) */}
      {isSelected && (
        <mesh position={[0, height / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(width, depth) / 2 + 0.2, Math.max(width, depth) / 2 + 0.25, 32]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.8} side={THREE.DoubleSide} depthTest={false} />
        </mesh>
      )}

      {/* 6. Floating Label */}
      {showLabels && (
        <Text
          position={[0, height + 0.3, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.25}
          color={isSelected ? "#3b82f6" : "#374151"}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#ffffff"
        >
          {name} {sku && `(${sku})`}
        </Text>
      )}
    </group>
  );
}