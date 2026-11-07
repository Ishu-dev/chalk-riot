import * as THREE from 'three';
import { FENCE_R } from './config';
import { groundTexture, slabTexture } from './chalk';
import type { Seg } from './geom';

/** Fixed cover in the middle of the court, point-symmetric so neither side is favoured. */
export const FIXED_COVER: Seg[] = [
  { ax: -5, az: -6, bx: -5, bz: -1.5 },
  { ax: 5, az: 6, bx: 5, bz: 1.5 },
  { ax: -10, az: 5, bx: -7, bz: 8 },
  { ax: 10, az: -5, bx: 7, bz: -8 },
  { ax: -1.8, az: 2.5, bx: 1.8, bz: 2.5 },
  { ax: 1.8, az: -2.5, bx: -1.8, bz: -2.5 },
];

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private rain!: THREE.LineSegments;
  private rainPos!: Float32Array;
  private washMat!: THREE.ShaderMaterial;
  private dryRing!: THREE.LineLoop;
  private hemi!: THREE.HemisphereLight;
  private bolt = 0;
  private t = 0;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.prepend(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x121417);
    this.scene.fog = new THREE.Fog(0x121417, 40, 80);
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
    this.camera.position.set(0, 38, 21);
    this.camera.lookAt(0, 0, 0.6);

    this.hemi = new THREE.HemisphereLight(0xa7bccf, 0x15171a, 1.1);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xdfe8ff, 1.4);
    sun.position.set(-12, 22, 10);
    this.scene.add(sun);

    this.buildGround();
    this.buildFence();
    for (const s of FIXED_COVER) this.addSlab(s, 1.5);
    this.buildRain();
    this.buildWash();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildGround(): void {
    const tex = groundTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.15 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Puddles: glossy pale patches that catch the light like the reference.
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const puddleMat = new THREE.MeshStandardMaterial({ color: 0x86a6b4, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.42 });
    const spots: [number, number][] = [[-16, 2], [15, -3], [-6, 12], [7, -12], [-13, -10], [13, 10]];
    for (const [x, z] of spots) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(1, 24), puddleMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(x, 0.01, z);
      p.scale.set(rnd(1.5, 3.2), rnd(0.8, 1.6), 1);
      p.rotation.z = rnd(0, Math.PI);
      this.scene.add(p);
    }
  }

  private buildFence(): void {
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const a1 = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
      this.addSlab({ ax: Math.cos(a0) * FENCE_R, az: Math.sin(a0) * FENCE_R, bx: Math.cos(a1) * FENCE_R, bz: Math.sin(a1) * FENCE_R }, 1.3, 0.5);
    }
  }

  /** Concrete slab along a segment. Used for the fence and fixed cover. */
  addSlab(s: Seg, height: number, thick = 0.4): THREE.Mesh {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const tex = slabTexture().clone();
    tex.repeat.set(Math.max(1, len / 3), 1);
    tex.needsUpdate = true;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, height, thick), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    mesh.position.set((s.ax + s.bx) / 2, height / 2, (s.az + s.bz) / 2);
    mesh.rotation.y = -Math.atan2(s.bz - s.az, s.bx - s.ax);
    this.scene.add(mesh);
    return mesh;
  }

  private buildRain(): void {
    const n = 1400;
    this.rainPos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) this.resetDrop(i, Math.random() * 20);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xa9bfd1, transparent: true, opacity: 0.32 }));
    this.scene.add(this.rain);
  }

  private resetDrop(i: number, y: number): void {
    const x = (Math.random() - 0.5) * 52;
    const z = (Math.random() - 0.5) * 40;
    const p = this.rainPos;
    p.set([x, y, z, x + 0.12, y + 0.9, z + 0.05], i * 6);
  }

  /** Washed-out zone: a darkened, rippling ground overlay outside the dry radius. */
  private buildWash(): void {
    this.washMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uR: { value: 21 }, uT: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vXZ;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vXZ = w.xz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uR; uniform float uT;
        varying vec2 vXZ;
        void main() {
          float d = length(vXZ);
          float edge = smoothstep(uR - 0.25, uR + 0.6, d);
          if (edge <= 0.0) discard;
          float ripple = 0.5 + 0.5 * sin(d * 2.2 - uT * 3.0);
          vec3 col = mix(vec3(0.10, 0.16, 0.24), vec3(0.20, 0.30, 0.42), ripple * 0.5);
          gl_FragColor = vec4(col, edge * 0.55);
        }`,
    });
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), this.washMat);
    wash.rotation.x = -Math.PI / 2;
    wash.position.y = 0.03;
    this.scene.add(wash);

    const pts = Array.from({ length: 96 }, (_, i) => {
      const a = (i / 96) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    });
    this.dryRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x9fd8ff, dashSize: 0.02, gapSize: 0.015, transparent: true, opacity: 0.7 }));
    this.dryRing.computeLineDistances();
    this.dryRing.position.y = 0.05;
    this.scene.add(this.dryRing);
  }

  /** Lightning: light the court up for a moment. */
  lightning(k: number): void {
    this.bolt = Math.max(this.bolt, k);
  }

  /** rain: 0 drizzle to 1 downpour, sets how many streaks fall and how fast. */
  update(dt: number, dryR: number, rain = 0): void {
    this.t += dt;
    this.bolt = Math.max(0, this.bolt - dt * 4);
    this.hemi.intensity = 1.1 + this.bolt * 4;
    const p = this.rainPos;
    const n = p.length / 6;
    this.rain.geometry.setDrawRange(0, Math.floor(n * (0.45 + 0.55 * rain)) * 2);
    const fall = 22 + rain * 12;
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      p[o + 1] -= fall * dt;
      p[o + 4] -= fall * dt;
      p[o] -= 3 * dt;
      p[o + 3] -= 3 * dt;
      if (p[o + 1] < 0) this.resetDrop(i, 18 + Math.random() * 2);
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.washMat.uniforms.uR.value = dryR;
    this.washMat.uniforms.uT.value = this.t;
    this.dryRing.scale.setScalar(dryR);
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Keep the whole court in view on narrow screens.
    this.camera.fov = Math.min(80, 40 * Math.max(1, 1.6 / aspect));
    this.camera.updateProjectionMatrix();
  }

  /** Mouse position on the ground plane. */
  groundPoint(clientX: number, clientY: number, out: THREE.Vector3): boolean {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), out) !== null;
  }
}
