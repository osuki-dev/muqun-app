/**
 * The computers in the Stage's world: one luminous core per computer, a thin
 * orbit ring around it and its agents as orbs on the ring. Three instanced
 * draws whatever the count -- the cores with their halos, the rings, the
 * orbs -- each an unlit quad shaded in its fragment shader:
 *
 *   core  -- a camera-facing quad shading a sphere: a deep glassy body, a
 *            fresnel rim and a glowing heart in the theme's primary, a soft
 *            highlight, and around it a halo (the warning colour while the
 *            computer needs the reader)
 *   ring  -- a quad in the ring's plane drawing a hairline annulus (a pixel
 *            or so wide at any foreshortening) with a faint glow band, its
 *            near side brighter
 *   orbs  -- camera-facing quads: a bright dot (a hollow one for "+N") in a
 *            soft glow
 *
 * There is no depth buffer: the rings and orbs are drawn after the cores and
 * hide where the core is in front of them, by testing the line of sight
 * against the core's sphere (`stageBehindCore` does the same for touches).
 * Night glows add light; by day they lie over the scene, as the old status
 * glows did. Everything is written per frame from at most 8 cores and 64
 * orbs; nothing is allocated.
 */
import {
  Color,
  CustomBlending,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Vector3,
  TSL,
  type Camera,
  type Node,
} from 'three/webgpu';

import {
  STAGE_MAX_SCREENS,
  STAGE_RING_AXES,
  STAGE_RING_SCALE,
  type StageCore,
  type StageVec3,
} from '@/lib/home-stage-geometry';
import { STAGE_ORB_CAP, type StageOrbMark } from '@/lib/home-stage-orbs';

const {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  fwidth,
  length,
  max,
  mix,
  positionGeometry,
  smoothstep,
  sqrt,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} = TSL;

/** Draw order among the scene's layers: after the frame and the motes. */
export const STAGE_CORE_ORDER = 5;

/** The halo reaches this many core radii from the centre; fewer at `low`. */
const HALO_FULL = 2.9;
const HALO_LITE = 1.8;
/** An orb's glow reaches this many dot radii; fewer at `low`. */
const ORB_GLOW_FULL = 4.2;
const ORB_GLOW_LITE = 2.4;
/** The ring's quad reaches past the ring, for its glow band. */
const RING_QUAD = 1.14;

export type StageCoreLook = {
  tone: 'online' | 'offline' | 'unknown' | 'warning';
  working: boolean;
  attention: boolean;
};

export type StageCoreColors = {
  primary: string;
  warning: string;
  /** An offline core's body and ring. */
  offline: string;
  text: string;
};

/** One core as drawn this frame. */
export type StageCoreFrame = {
  core: StageCore;
  look: StageCoreLook;
  /** Its orbs, placed this frame. */
  orbs: readonly { mark: StageOrbMark; point: StageVec3; presence: number }[];
};

export type StageCoresInput = {
  camera: Camera;
  cores: readonly StageCoreFrame[];
  /** The ambient clock, seconds: a working core breathes and a waiting orb pulses on it. */
  timeS: number;
  /** Breathing and pulsing on; off at `low` and under Reduce Motion (the clock is frozen then too). */
  breathe: boolean;
  /** Full halos and orb glows, or fewer and smaller. */
  fullGlow: boolean;
  /** 0..1, decaying after a task completes: the front core flares. */
  burst: number;
};

/** Straight colour and alpha out as premultiplied, for One / OneMinusSrcAlpha blending. */
function glowMaterial() {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  material.blending = CustomBlending;
  material.blendSrc = OneFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneMinusSrcAlphaFactor;
  material.toneMapped = false;
  material.fog = false;
  return material;
}

function instanced(geometry: PlaneGeometry, material: MeshBasicNodeMaterial, capacity: number) {
  const mesh = new InstancedMesh(geometry, material, capacity);
  const identity = new Matrix4();
  for (let index = 0; index < capacity; index += 1) mesh.setMatrixAt(index, identity);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

function buffers(geometry: PlaneGeometry, capacity: number, names: readonly string[]) {
  return names.map((name) => {
    const values = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    geometry.setAttribute(name, values);
    return values;
  });
}

/** 0 where `point` is hidden behind the sphere at `centre`, 1 in the open; soft at the rim. */
function seen(point: Node<'vec3'>, centre: Node<'vec3'>, radius: Node<'float'>) {
  const ray = point.sub(cameraPosition);
  const reach = length(ray);
  const toCore = centre.sub(cameraPosition);
  const along = dot(toCore, ray.div(reach));
  const miss = sqrt(max(dot(toCore, toCore).sub(along.mul(along)), 0));
  const inside = float(1).sub(smoothstep(radius.mul(0.9), radius.mul(1.02), miss));
  const behind = smoothstep(along, along.add(radius.mul(0.2)), reach);
  return float(1).sub(inside.mul(behind).mul(0.94));
}

export function createStageCores() {
  // The camera's right and up, for the camera-facing quads; set every frame.
  const uRight = uniform(new Vector3(1, 0, 0));
  const uUp = uniform(new Vector3(0, 1, 0));
  /** 1 by day: glows lie over the scene rather than adding light. */
  const uDay = uniform(0);
  const uHalo = uniform(HALO_FULL);
  const uOrbGlow = uniform(ORB_GLOW_FULL);
  const white = vec3(1, 1, 1);
  const billboard = (centre: Node<'vec3'>, size: Node<'float'>) =>
    centre.add(uRight.mul(positionGeometry.x.mul(size))).add(uUp.mul(positionGeometry.y.mul(size)));
  /** Premultiplied out: a body over the scene, and a glow that adds light by night. */
  const out = (
    body: Node<'vec3'>,
    bodyAlpha: Node<'float'>,
    glow: Node<'vec3'>,
    glowAlpha: Node<'float'>
  ) =>
    vec4(
      body.mul(bodyAlpha).add(glow.mul(glowAlpha).mul(float(1).sub(bodyAlpha))),
      bodyAlpha.add(glowAlpha.mul(uDay).mul(float(1).sub(bodyAlpha)))
    );

  // -- Cores ------------------------------------------------------------------
  const coreGeometry = new PlaneGeometry(1, 1);
  const [coreAt, coreBody, coreHalo, coreLook] = buffers(coreGeometry, STAGE_MAX_SCREENS, [
    'aCoreAt',
    'aCoreBody',
    'aCoreHalo',
    'aCoreLook',
  ]);
  const cores = (() => {
    // centre xyz, radius
    const at = attribute('aCoreAt', 'vec4');
    // tint rgb (linear), heart 0..1
    const body = attribute('aCoreBody', 'vec4');
    // halo rgb, strength 0..1
    const halo = attribute('aCoreHalo', 'vec4');
    // brightness, desaturation, attention ring, -
    const look = attribute('aCoreLook', 'vec4');
    const material = glowMaterial();
    material.positionNode = billboard(at.xyz, at.w.mul(uHalo).mul(2));
    const s = uv().sub(0.5).mul(uHalo.mul(2));
    const d = length(s);
    const edge = max(fwidth(d), 0.002).mul(1.5);
    const inside = float(1).sub(smoothstep(float(1).sub(edge), 1, d));
    const nz = sqrt(max(float(1).sub(d.mul(d)), 0));
    const rim = float(1).sub(nz).pow(2.2);
    const heart = exp(d.mul(d).mul(-4.2)).mul(body.w);
    const shine = exp(
      length(s.sub(vec2(-0.36, 0.42)))
        .pow(2)
        .mul(-18)
    ).mul(0.45);
    const tint = mix(body.xyz, vec3(dot(body.xyz, vec3(0.2126, 0.7152, 0.0722))), look.y);
    // A deep glass sphere lit from within: by night its body dark and its
    // rim and heart bright; by day a jewel in the (deep) primary.
    const night = tint
      .mul(nz.mul(nz).mul(0.32).add(0.06))
      .add(tint.mul(rim).mul(1.1))
      .add(mix(tint, white, 0.55).mul(heart).mul(1.2));
    const day = tint
      .mul(nz.mul(0.3).add(0.72))
      .add(mix(tint, white, 0.7).mul(rim).mul(0.55))
      .add(mix(tint, white, 0.6).mul(heart.pow(1.6)).mul(0.6));
    // Dimmer (a neighbour, an offline computer) is darker by night and, by
    // day, fainter: a pale scene shows through rather than a grey disc.
    const shaded = mix(night, day, uDay)
      .add(white.mul(shine))
      .mul(mix(look.x, float(1), uDay));
    // The halo, falling off from the rim and gone at the quad's edge.
    const beyond = max(d.sub(1), 0);
    const fade = float(1).sub(smoothstep(uHalo.mul(0.7), uHalo, d));
    const glow = exp(beyond.mul(mix(float(-2.1), float(-1.5), uDay)))
      .mul(fade)
      .mul(halo.w)
      .mul(mix(float(0.55), float(0.4), uDay));
    // While it needs the reader, a fine ring in the halo's colour, which
    // reads by day where a glow would only smudge a pale scene.
    const attention = clamp(
      float(1).sub(abs(d.sub(1.2)).div(max(fwidth(d), 0.002).mul(1.2).add(0.025))),
      0,
      1
    ).mul(look.z);
    material.colorNode = out(
      shaded,
      inside.mul(0.96).mul(mix(float(1), look.x, uDay)),
      halo.xyz,
      max(glow, attention.mul(0.9))
    );
    const mesh = instanced(coreGeometry, material, STAGE_MAX_SCREENS);
    mesh.renderOrder = STAGE_CORE_ORDER;
    return mesh;
  })();

  // -- Rings ------------------------------------------------------------------
  const ringGeometry = new PlaneGeometry(1, 1);
  const [ringAt, ringTint] = buffers(ringGeometry, STAGE_MAX_SCREENS, ['aRingAt', 'aRingTint']);
  const rings = (() => {
    // centre xyz, ring radius
    const at = attribute('aRingAt', 'vec4');
    // rgb, strength; the core's radius
    const tint = attribute('aRingTint', 'vec4');
    const coreRadius = at.w.div(STAGE_RING_SCALE);
    const material = glowMaterial();
    const local = positionGeometry.xy.mul(at.w.mul(RING_QUAD * 2));
    const place = at.xyz
      .add(vec3(...STAGE_RING_AXES.across).mul(local.x))
      .add(vec3(...STAGE_RING_AXES.far).mul(local.y));
    material.positionNode = place;
    const world = varying(place);
    const q = uv()
      .sub(0.5)
      .mul(RING_QUAD * 2);
    const rho = length(q);
    const off = abs(rho.sub(1));
    // A hairline about a pixel and a half wide however the ring is turned.
    const line = clamp(float(1).sub(off.div(fwidth(rho).mul(1.4).add(0.004))), 0, 1);
    const band = exp(off.div(0.07).pow(2).negate()).mul(0.2);
    // The near half (towards the camera) is brighter.
    const near = smoothstep(0.35, -0.7, q.y).mul(0.5).add(0.5);
    const alpha = line
      .add(band)
      .mul(near)
      .mul(tint.w)
      .mul(seen(world, at.xyz, coreRadius))
      .mul(float(1).sub(smoothstep(RING_QUAD * 0.92, RING_QUAD, rho)));
    material.colorNode = out(
      vec3(0),
      float(0),
      mix(tint.xyz, white, mix(float(0.25), float(0), uDay)),
      alpha
    );
    const mesh = instanced(ringGeometry, material, STAGE_MAX_SCREENS);
    mesh.renderOrder = STAGE_CORE_ORDER + 0.1;
    return mesh;
  })();

  // -- Orbs -------------------------------------------------------------------
  const orbCapacity = STAGE_MAX_SCREENS * STAGE_ORB_CAP;
  const orbGeometry = new PlaneGeometry(1, 1);
  const [orbAt, orbTint, orbCore] = buffers(orbGeometry, orbCapacity, [
    'aOrbAt',
    'aOrbTint',
    'aOrbCore',
  ]);
  const orbs = (() => {
    // centre xyz, dot radius
    const at = attribute('aOrbAt', 'vec4');
    // rgb, strength
    const tint = attribute('aOrbTint', 'vec4');
    // its core's centre xyz and radius, signed: negative for a hollow "+N" orb
    const core = attribute('aOrbCore', 'vec4');
    const material = glowMaterial();
    material.positionNode = billboard(at.xyz, at.w.mul(uOrbGlow).mul(2));
    const s = uv().sub(0.5).mul(uOrbGlow.mul(2));
    const d = length(s);
    const edge = max(fwidth(d), 0.01).mul(1.5);
    const hollow = smoothstep(0, -0.5, core.w);
    const solid = float(1).sub(smoothstep(float(1).sub(edge), 1, d));
    const ring = float(1).sub(smoothstep(edge.mul(0.5), edge.mul(1.5).add(0.12), abs(d.sub(0.82))));
    const body = mix(solid, ring, hollow);
    const glow = exp(max(d.sub(0.7), 0).mul(-1.5))
      .mul(float(1).sub(smoothstep(uOrbGlow.mul(0.6), uOrbGlow, d)))
      .mul(mix(float(0.7), float(0.15), hollow));
    const visible = seen(at.xyz, core.xyz, abs(core.w)).mul(tint.w);
    // A hot centre by night; a solid dot by day, so it reads on a pale scene.
    const centre = mix(mix(tint.xyz, white, float(0.55).mul(float(1).sub(d))), tint.xyz, uDay);
    material.colorNode = out(
      centre,
      body.mul(visible).mul(mix(float(0.92), float(1), uDay)),
      tint.xyz,
      glow.mul(visible).mul(mix(float(1), float(0.45), uDay))
    );
    const mesh = instanced(orbGeometry, material, orbCapacity);
    mesh.renderOrder = STAGE_CORE_ORDER + 0.2;
    return mesh;
  })();

  // -- Per-frame state --------------------------------------------------------
  const colors = {
    primary: new Color(),
    warning: new Color(),
    offline: new Color(),
    idle: new Color(),
    more: new Color(),
  };
  let light = false;
  const scratch = new Vector3();

  return {
    meshes: [cores, rings, orbs] as const,
    setTheme(palette: StageCoreColors, mode: 'light' | 'dark') {
      light = mode === 'light';
      uDay.value = light ? 1 : 0;
      colors.primary.set(palette.primary);
      colors.warning.set(palette.warning);
      colors.offline.set(palette.offline);
      // An idle agent: the primary, quieter.
      colors.idle.set(palette.primary).lerp(new Color(palette.text), light ? 0.35 : 0.45);
      colors.more.set(palette.text);
    },
    update(input: StageCoresInput) {
      const { camera, timeS } = input;
      scratch.setFromMatrixColumn(camera.matrixWorld, 0);
      uRight.value.copy(scratch);
      scratch.setFromMatrixColumn(camera.matrixWorld, 1);
      uUp.value.copy(scratch);
      uHalo.value = input.fullGlow ? HALO_FULL : HALO_LITE;
      uOrbGlow.value = input.fullGlow ? ORB_GLOW_FULL : ORB_GLOW_LITE;
      const breath = input.breathe ? 0.84 + 0.16 * Math.sin(timeS * 1.7) : 1;
      let orbCount = 0;
      const count = Math.min(input.cores.length, STAGE_MAX_SCREENS);
      for (let index = 0; index < count; index += 1) {
        const { core, look, orbs: placed } = input.cores[index]!;
        const offline = look.tone === 'offline' || look.tone === 'unknown';
        const working = look.working && !offline;
        const warn = !offline && (look.attention || look.tone === 'warning');
        const front = 1 - core.side;
        const bright = 0.42 + 0.58 * front;
        const [x, y, z] = core.position;
        const body = offline ? colors.offline : colors.primary;
        // The heart: a running computer burns brightest, a quiet one steadily.
        const heart = offline ? 0 : (working ? 1 : 0.55) * (working ? breath : 1);
        const flare = input.burst * front;
        coreAt.setXYZW(index, x, y, z, core.radius);
        coreBody.setXYZW(index, body.r, body.g, body.b, Math.min(1.4, heart + flare * 0.6));
        const haloColor = warn ? colors.warning : colors.primary;
        const haloStrength = offline
          ? 0
          : (warn ? 1 : working ? 0.85 * breath : 0.55) * (0.55 + 0.45 * front) + flare * 0.5;
        coreHalo.setXYZW(index, haloColor.r, haloColor.g, haloColor.b, haloStrength);
        coreLook.setXYZW(
          index,
          offline ? 0.55 * bright : bright,
          offline ? 0.85 : 0.15 * core.side,
          warn ? bright : 0,
          0
        );
        ringAt.setXYZW(index, x, y, z, core.ringRadius);
        ringTint.setXYZW(index, body.r, body.g, body.b, (offline ? 0.3 : 0.75) * bright);
        placed.forEach((orb, slot) => {
          if (orbCount >= orbCapacity) return;
          const color =
            orb.mark === 'needs-you'
              ? colors.warning
              : orb.mark === 'working'
                ? colors.primary
                : orb.mark === 'more'
                  ? colors.more
                  : colors.idle;
          const pulse =
            orb.mark === 'needs-you' && input.breathe ? 0.8 + 0.2 * Math.sin(timeS * 3 + slot) : 1;
          const strength =
            orb.mark === 'working' || orb.mark === 'needs-you'
              ? 1
              : orb.mark === 'more'
                ? 0.6
                : 0.5;
          const size =
            core.orbRadius * (orb.mark === 'needs-you' ? 1.2 : orb.mark === 'idle' ? 0.85 : 1);
          orbAt.setXYZW(
            orbCount,
            orb.point[0],
            orb.point[1],
            orb.point[2],
            size * orb.presence * pulse
          );
          orbTint.setXYZW(orbCount, color.r, color.g, color.b, strength * bright * orb.presence);
          orbCore.setXYZW(orbCount, x, y, z, orb.mark === 'more' ? -core.radius : core.radius);
          orbCount += 1;
        });
      }
      cores.count = count;
      rings.count = count;
      orbs.count = orbCount;
      for (const values of [
        coreAt,
        coreBody,
        coreHalo,
        coreLook,
        ringAt,
        ringTint,
        orbAt,
        orbTint,
        orbCore,
      ])
        values!.needsUpdate = true;
    },
    dispose() {
      for (const mesh of [cores, rings, orbs]) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicNodeMaterial).dispose();
      }
    },
  };
}

export type StageCoresLayer = ReturnType<typeof createStageCores>;
