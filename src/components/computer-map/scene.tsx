import { extend, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import type {
  ConnectionMapEdge,
  ConnectionMapNode,
  MapPosition,
} from '@/lib/computer-connection-map';
import type { ComputerMapSceneProps } from './types';

// Only the geometry/material catalogue this scene needs; no models, textures or lighting loop.
extend({ BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial });

function ComputerNode({
  node,
  color,
  selected,
}: {
  node: ConnectionMapNode;
  color: string;
  selected: boolean;
}) {
  return (
    <group position={node.position} userData={{ nodeId: node.id }}>
      <mesh position={[0, 0.4, 0]} userData={{ nodeId: node.id }}>
        <boxGeometry args={node.serverId ? [0.75, 0.48, 0.16] : [0.34, 0.65, 0.12]} />
        <meshBasicMaterial color={color} wireframe={node.status === 'unknown'} />
      </mesh>
      {node.serverId ? (
        <mesh position={[0, 0.08, 0]} userData={{ nodeId: node.id }}>
          <boxGeometry args={[0.42, 0.1, 0.3]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ) : null}
      {selected ? (
        <mesh position={[0, -0.1, 0]}>
          <cylinderGeometry args={[0.52, 0.52, 0.035, 20]} />
          <meshBasicMaterial color={color} transparent opacity={0.3} />
        </mesh>
      ) : null}
    </group>
  );
}

function edgeTransform(from: MapPosition, to: MapPosition, start: number, end: number) {
  const a = new Vector3(...from);
  const delta = new Vector3(...to).sub(a);
  return {
    position: a.addScaledVector(delta, (start + end) / 2).toArray() as MapPosition,
    quaternion: new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      delta.clone().normalize()
    ),
    length: delta.length() * (end - start),
  };
}

function ConnectionEdge({
  edge,
  from,
  to,
  color,
}: {
  edge: ConnectionMapEdge;
  from: MapPosition;
  to: MapPosition;
  color: string;
}) {
  const dashed = edge.kind === 'peer' || edge.status !== 'live';
  const segments = dashed ? [0.15, 0.3, 0.45, 0.6, 0.75] : [0.15];
  const arrow = edgeTransform(from, to, 0.8, 0.85);
  return (
    <group position={[0, -0.05, 0]}>
      {segments.map((start) => {
        const segment = edgeTransform(from, to, start, dashed ? start + 0.08 : 0.83);
        return (
          <mesh key={start} position={segment.position} quaternion={segment.quaternion}>
            <cylinderGeometry args={[0.014, 0.014, segment.length, 4]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      })}
      {edge.kind === 'peer' ? (
        <mesh position={arrow.position} quaternion={arrow.quaternion}>
          <coneGeometry args={[0.07, 0.19, 6]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ) : null}
    </group>
  );
}

export function ComputerScene({ graph, selectedId, pose, colors }: ComputerMapSceneProps) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    camera.position.set(
      Math.sin(pose.yaw) * Math.cos(pose.pitch) * pose.distance,
      Math.sin(pose.pitch) * pose.distance,
      Math.cos(pose.yaw) * Math.cos(pose.pitch) * pose.distance
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    invalidate();
  }, [camera, invalidate, pose]);
  return (
    <>
      <color attach="background" args={[colors.background]} />
      {graph.edges.map((edge) => {
        const from = graph.nodes.find((node) => node.id === edge.from);
        const to = graph.nodes.find((node) => node.id === edge.to);
        return from && to ? (
          <ConnectionEdge
            key={edge.id}
            edge={edge}
            from={from.position}
            to={to.position}
            color={edge.kind === 'peer' ? colors.unknown : colors[edge.status]}
          />
        ) : null;
      })}
      {graph.nodes.map((node) => (
        <ComputerNode
          key={node.id}
          node={node}
          selected={node.id === selectedId}
          color={
            node.id === selectedId
              ? colors.accent
              : node.serverId
                ? colors[node.status]
                : colors.foreground
          }
        />
      ))}
    </>
  );
}
