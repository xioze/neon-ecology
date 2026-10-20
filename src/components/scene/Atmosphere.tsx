import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

/**
 * Static lighting rig + slow-floating "data motes". Kept memoized so the
 * per-tick React render never rebuilds materials or particles.
 */
export const Atmosphere = memo(function Atmosphere() {
  const pointsRef = useRef<THREE.Points | null>(null);

  const geometry = useMemo(() => {
    const count = 460;
    const positions = new Float32Array(count * 3);
    let seed = 7321;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (random() - 0.5) * 74;
      positions[i * 3 + 1] = 0.6 + random() * 26;
      positions[i * 3 + 2] = (random() - 0.5) * 66;
    }
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return buffer;
  }, []);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: "#8fe8ff",
        size: 0.3,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        toneMapped: false,
      }),
    [],
  );

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;
    const time = clock.elapsedTime;
    points.rotation.y = time * 0.006;
    points.position.y = Math.sin(time * 0.18) * 0.9;
  });

  return (
    <group>
      <ambientLight intensity={0.55} color="#40647a" />
      <hemisphereLight args={["#31587a", "#160c1e", 0.85]} />
      <directionalLight position={[36, 52, 24]} intensity={1.2} color="#a9d4ff" />
      <directionalLight position={[-32, 22, -26]} intensity={0.42} color="#ff4fa3" />
      <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
});
