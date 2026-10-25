"use client";

import React, { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { 
  OrbitControls, 
  Environment, 
  Text, 
  ContactShadows 
} from "@react-three/drei";
import * as THREE from "three";
import { convert2DTo3D, generateRoomShape } from "./3dConversionEngine";

/**
 * Main Scene Wrapper
 */
export default function Scene({
  floorPlanData,
  height = 2.5,
  wallThickness = 0.15,
  roomColors = {},
  roomTextures = {},
  lightIntensity = 1,
  viewMode = "3d"
}) {
  const enhancedData = useMemo(() => 
    convert2DTo3D(floorPlanData, { wallHeight: height, wallThickness }), 
    [floorPlanData, height, wallThickness]
  );

  const { dimensions } = enhancedData;
  const maxDimension = Math.max(dimensions.width, dimensions.height);
  const cameraDistance = maxDimension * 1.2;

  return (
    <div className="w-full h-[600px] bg-gray-100 rounded-md overflow-hidden relative">
      <Canvas
        shadows // CRITICAL: Enables shadow map rendering
        dpr={[1, 2]} // Optimizes pixel ratio for retina displays
        camera={{ 
          position: viewMode === "3d" 
            ? [cameraDistance, cameraDistance * 0.8, cameraDistance] 
            : [0, cameraDistance * 1.5, 0],
          fov: 45
        }}
      >
        {/* 1. Advanced Lighting & Shadows */}
        <ambientLight intensity={0.4 * lightIntensity} />
        <directionalLight
          position={[15, 20, 10]}
          intensity={1.2 * lightIntensity}
          castShadow
          shadow-mapSize={[2048, 2048]} // High-res shadows
          shadow-camera-left={-maxDimension}
          shadow-camera-right={maxDimension}
          shadow-camera-top={maxDimension}
          shadow-camera-bottom={-maxDimension}
          shadow-camera-near={0.5}
          shadow-camera-far={60}
          shadow-bias={-0.0001} // Prevents shadow acne
        />

        {/* HDRI Environment for realistic material reflections */}
        <Environment preset="city" background={false} />

        {/* 2. 3D Content */}
        <FloorPlan3D
          floorPlanData={enhancedData}
          height={height}
          wallThickness={wallThickness}
          roomColors={roomColors}
          roomTextures={roomTextures}
          viewMode={viewMode}
        />

        {/* 3. Grounding Contact Shadows (Makes objects feel planted) */}
        <ContactShadows
          position={[0, 0.01, 0]}
          opacity={0.4}
          scale={maxDimension * 2}
          blur={2}
          far={4}
          resolution={1024}
          color="#000000"
        />

        {/* 4. Interactive Controls */}
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={viewMode === "3d"}
          minDistance={2}
          maxDistance={maxDimension * 2}
          // Prevent camera from going below the floor
          maxPolarAngle={viewMode === "3d" ? Math.PI / 2 - 0.05 : Math.PI / 2 + 0.1}
          minPolarAngle={viewMode === "3d" ? 0 : Math.PI / 2 - 0.1}
        />
      </Canvas>
    </div>
  );
}

/**
 * Floor Plan Container
 */
function FloorPlan3D({ floorPlanData, height, wallThickness, roomColors, roomTextures, viewMode }) {
  const { rooms, walls, dimensions } = floorPlanData;
  const centerX = dimensions.width / 2;
  const centerY = dimensions.height / 2;

  return (
    <group position={[-centerX, 0, -centerY]}>
      {/* Floor Base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centerX, 0, centerY]} receiveShadow>
        <planeGeometry args={[dimensions.width, dimensions.height]} />
        <meshStandardMaterial color="#f3f4f6" roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Rooms */}
      {rooms.map((room) => (
        <Room3D
          key={room.id}
          room={room}
          height={height}
          color={roomColors[room.id] || "#ffffff"}
          texture={roomTextures[room.id]}
          viewMode={viewMode}
        />
      ))}

      {/* Walls */}
      {walls.map((wall, index) => (
        <Wall3D
          key={`wall-${wall.id || index}`}
          wall={wall}
          height={height}
          thickness={wallThickness}
          viewMode={viewMode}
        />
      ))}
    </group>
  );
}

/**
 * Individual Room Component
 */
function Room3D({ room, height, color, texture, viewMode }) {
  // Memoize shape generation to prevent recalculation on every render
  const shape = useMemo(() => {
    return generateRoomShape(room.floorVertices || []);
  }, [room.floorVertices]);

  // Memoize geometry creation
  const geometry = useMemo(() => {
    if (!shape) return null;
    return new THREE.ExtrudeGeometry(shape, {
      steps: 1,
      depth: viewMode === "3d" ? height : 0.01,
      bevelEnabled: false,
    });
  }, [shape, height, viewMode]);

  if (!geometry) return null;

  return (
    <group>
      {/* 
        PERFORMANCE FIX: Apply rotation statically to the mesh instead of 
        using useFrame, which forces a recalculation 60 times per second.
      */}
      <mesh 
        geometry={geometry} 
        rotation={[-Math.PI / 2, 0, 0]} 
        castShadow 
        receiveShadow
      >
        <meshStandardMaterial
          color={color}
          map={texture ? new THREE.TextureLoader().load(texture) : undefined}
          transparent
          opacity={viewMode === "3d" ? 0.95 : 0.6}
          side={THREE.DoubleSide}
          roughness={0.8}
        />
      </mesh>

      {/* Room Label */}
      {viewMode === "3d" && room.center && (
        <Text
          position={[room.center.x, height + 0.15, room.center.y]}
          rotation={[-Math.PI / 2, 0, 0]} // Keep text flat and readable
          color="#1f2937"
          fontSize={0.35}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#ffffff"
        >
          {room.name}
        </Text>
      )}
    </group>
  );
}

/**
 * Individual Wall Component
 */
function Wall3D({ wall, height, thickness, viewMode }) {
  const length = wall.length || Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const angle = wall.angle || Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
  
  const is3d = viewMode === "3d";
  const wallH = is3d ? height : 0.1;
  const wallT = is3d ? thickness : thickness * 2;
  
  const position = [
    (wall.start.x + wall.end.x) / 2,
    is3d ? wallH / 2 : 0.05,
    (wall.start.y + wall.end.y) / 2,
  ];

  return (
    <group position={position} rotation={[0, angle, 0]}>
      {/* Main Wall Segment */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[length, wallH, wallT]} />
        <meshStandardMaterial color="#e5e7eb" roughness={0.9} metalness={0.1} />
      </mesh>

      {/* Opening Representation (Door/Window) */}
      {is3d && wall.hasOpening && (
        <group position={[0, -wallH / 2 + 1.05, 0]}>
          {/* Door/Window Frame */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[1.05, 2.15, wallT + 0.02]} />
            <meshStandardMaterial color="#4b5563" roughness={0.6} />
          </mesh>
          {/* Door Panel / Glass */}
          <mesh position={[0, 0, wallT / 2 + 0.01]} castShadow>
            <boxGeometry args={[0.9, 2.0, 0.05]} />
            <meshStandardMaterial color="#ffffff" roughness={0.2} metalness={0.1} />
          </mesh>
        </group>
      )}
    </group>
  );
}