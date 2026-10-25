import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useSpring, animated, config as springConfig } from '@react-spring/three';
import { EffectComposer, Bloom, DepthOfField, Vignette } from '@react-three/postprocessing';
import { Pathfinding } from 'three-pathfinding';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as THREE from 'three';
import Cabinet from './Cabinet';

/**
 * Post-processing from LabPostProcessing, applied to the main scene instead of a
 * demo canvas. Rendered only when at least one effect is on.
 */
export function PostEffects({ bloom, dof, vignette }) {
  if (!bloom && !dof && !vignette) return null;
  return (
    <EffectComposer>
      {bloom && (
        <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.5} />
      )}
      {dof && <DepthOfField focusDistance={0} focalLength={0.02} bokehScale={2} />}
      {vignette && <Vignette offset={0.3} darkness={0.5} />}
    </EffectComposer>
  );
}

/** LabReactSpring's spring behaviour, wrapped around a real cabinet. */
export function SpringCabinet({ active, ...cabinetProps }) {
  const style = useSpring({
    scale: active ? 1.08 : 1,
    config: springConfig.wobbly
  });
  return (
    <animated.group scale={style.scale}>
      <Cabinet {...cabinetProps} />
    </animated.group>
  );
}

/** LabInstancing's single-draw-call field, sized to the room. */
export function InstancedProps({ count, width, depth }) {
  const meshRef = useRef();

  const matrices = useMemo(() => {
    const out = [];
    const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
    const cellW = width / (columns + 1);
    const cellD = depth / (columns + 1);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / columns);
      const column = i % columns;
      out.push([
        -width / 2 + cellW * (column + 1),
        0.05,
        -depth / 2 + cellD * (row + 1)
      ]);
    }
    return out;
  }, [count, width, depth]);

  useEffect(() => {
    if (!meshRef.current) return;
    const dummy = new THREE.Object3D();
    matrices.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [matrices]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} castShadow receiveShadow>
      <boxGeometry args={[0.6, 1, 0.6]} />
      <meshStandardMaterial color="#4299e1" />
    </instancedMesh>
  );
}

/**
 * LabPathfinding's navmesh agent, walking to the selected cabinet. The navmesh
 * is built from the room floor rather than a fixed demo plane.
 */
export function PathAgent({ target, width, depth }) {
  const pathfinder = useRef(new Pathfinding());
  const agentRef = useRef();
  const [path, setPath] = useState([]);
  const [step, setStep] = useState(0);
  const zone = 'kitchen';

  useEffect(() => {
    const floor = new THREE.BoxGeometry(width, 0.1, depth);
    pathfinder.current.setZoneData(zone, Pathfinding.createZone(floor));
    floor.dispose();
  }, [width, depth]);

  useEffect(() => {
    setStep(0);
    if (!target) {
      setPath([]);
      return;
    }
    const from = agentRef.current
      ? agentRef.current.position.clone()
      : new THREE.Vector3(0, 0.05, 0);
    from.y = 0.05;
    const to = new THREE.Vector3(target[0], 0.05, target[2]);
    const groupID = pathfinder.current.getGroup(zone, from);
    const found = groupID === null ? null : pathfinder.current.findPath(from, to, zone, groupID);
    setPath(found && found.length ? found : [from, to]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target && target[0], target && target[2], zone]);

  useFrame(() => {
    const agent = agentRef.current;
    if (!agent || path.length === 0) return;
    const next = path[step];
    if (!next) return;
    const dx = next.x - agent.position.x;
    const dz = next.z - agent.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.05) {
      setStep((current) => Math.min(current + 1, path.length - 1));
      return;
    }
    const speed = 0.05;
    agent.position.x += (dx / distance) * speed;
    agent.position.z += (dz / distance) * speed;
  });

  return (
    <group>
      <mesh ref={agentRef} position={[0, 0.55, 0]} castShadow>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial color="#48bb78" emissive="#48bb78" emissiveIntensity={0.2} />
      </mesh>
      {path.map((point, index) => (
        <mesh key={index} position={[point.x, 0.1, point.z]}>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshBasicMaterial color="#ed8936" />
        </mesh>
      ))}
    </group>
  );
}

/**
 * LabShaker3DViewer + LabShakerPhysics + LabDracoCompression: the showroom model
 * loaded through the DRACO pipeline and dropped into the kitchen, with the
 * shake simulation from the physics lab driven by the panel.
 */
export function ShakerProp({ shaking, intensity, position = [0, 0, 0], scale = 1 }) {
  const [model, setModel] = useState(null);
  const groupRef = useRef();
  const velocity = useRef(new THREE.Vector3());
  const offset = useRef(new THREE.Vector3());

  useEffect(() => {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(draco);
    let cancelled = false;
    loader.load(
      '/shaker.glb',
      (gltf) => {
        if (cancelled) return;
        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        setModel(gltf.scene);
      },
      undefined,
      (error) => console.warn('shaker.glb failed to load', error)
    );
    return () => {
      cancelled = true;
      draco.dispose();
    };
  }, []);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;

    if (shaking) {
      velocity.current.add(
        new THREE.Vector3(
          (Math.random() - 0.5) * intensity,
          (Math.random() - 0.5) * intensity,
          (Math.random() - 0.5) * intensity
        ).multiplyScalar(delta)
      );
      offset.current.addScaledVector(velocity.current, delta);
      velocity.current.multiplyScalar(0.95);
      offset.current.x = THREE.MathUtils.clamp(offset.current.x, -0.3, 0.3);
      offset.current.y = THREE.MathUtils.clamp(offset.current.y, -0.1, 0.1);
      offset.current.z = THREE.MathUtils.clamp(offset.current.z, -0.3, 0.3);
      group.position.set(
        position[0] + offset.current.x,
        position[1] + offset.current.y,
        position[2] + offset.current.z
      );
      group.rotation.z = Math.sin(state.clock.elapsedTime * 20) * 0.1 * intensity;
    } else {
      offset.current.lerp(new THREE.Vector3(0, 0, 0), 0.1);
      velocity.current.multiplyScalar(0.9);
      group.position.set(
        position[0] + offset.current.x,
        position[1] + offset.current.y,
        position[2] + offset.current.z
      );
      group.rotation.z *= 0.9;
    }
  });

  return (
    <group ref={groupRef} position={position} scale={scale}>
      {model && <primitive object={model} />}
    </group>
  );
}

/**
 * LabGLTFExport, pointed at the live scene instead of a demo group. The panel
 * gets these functions through the register ref.
 */
export function SceneExporter({ register }) {
  const { scene } = useThree();

  useEffect(() => {
    if (!register) return;

    const download = (data, name, type) => {
      const blob = new Blob([data], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    };

    register.current = {
      gltf: (binary = false) => {
        new GLTFExporter().parse(
          scene,
          (result) =>
            binary
              ? download(result, 'kitchen.glb', 'application/octet-stream')
              : download(JSON.stringify(result, null, 2), 'kitchen.gltf', 'application/json'),
          (error) => console.error('GLTF export failed', error),
          { binary, embedImages: true }
        );
      },
      obj: () => download(new OBJExporter().parse(scene), 'kitchen.obj', 'text/plain')
    };
  }, [scene, register]);

  return null;
}
