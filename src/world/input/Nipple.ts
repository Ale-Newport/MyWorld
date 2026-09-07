import * as THREE from 'three'
import { Events } from '../core/Events'
import { clamp, smallestAngle } from '../core/maths'
import { palette } from '../core/palette'
import { easing, type Tweens } from '../core/Tween'
import type { Pointer } from './Pointer'
import type { Action } from './Inputs'

/* ============================================================
   PORTED FROM: sources/Game/Inputs/Nipple.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   The touch control, and the best idea in the upstream input
   layer: instead of an on-screen stick that fights the camera,
   the joystick is drawn ON THE GROUND around the car. You press
   anywhere and drag; the distance from the car is the throttle
   and the bearing is the steering. Because it lives in world
   space, it never covers the thing you are driving towards, and
   the car does not need a fixed screen position.

   Radii and angles are upstream's:
     inner radius        2      (dead zone — a tap here jumps)
     outer radius        4.5    (full throttle)
     forward amplitude   1.5π   (outside this arc, you reverse)

   Changes: the TSL node material is reimplemented as a GLSL
   `ShaderMaterial` (same SDF logic, line for line) and recoloured
   to the site palette; GSAP's jump tween becomes a `Tweens` call.
   ============================================================ */

const PROGRESS_RADIUS_LOW = 2
const PROGRESS_RADIUS_HIGH = 4.5
const EDGES_THICKNESS = 0.1
const OUTLINE_THICKNESS = 0.2
const FORWARD_AMPLITUDE = Math.PI * 1.5

const VERTEX = /* glsl */ `
  varying vec2 vRadial;
  void main() {
    vRadial = vec2(position.x, position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec2 vRadial;

  uniform float uProgress;
  uniform float uForward;
  uniform float uProgressStartAngle;
  uniform float uProgressEndAngle;
  uniform float uColorMultiplier;
  uniform float uOpacity;
  uniform vec3  uFillColor;
  uniform vec3  uOutlineColor;

  const float RADIUS_LOW  = ${PROGRESS_RADIUS_LOW.toFixed(4)};
  const float RADIUS_HIGH = ${PROGRESS_RADIUS_HIGH.toFixed(4)};
  const float EDGES       = ${EDGES_THICKNESS.toFixed(4)};
  const float OUTLINE     = ${OUTLINE_THICKNESS.toFixed(4)};
  const float FORWARD_AMP = ${FORWARD_AMPLITUDE.toFixed(6)};

  void main() {
    float len = length(vRadial);
    float radialAngle = atan(vRadial.y, vRadial.x);

    // Which half of the ring is "drive" and which is "reverse".
    float directionAngleSDF = abs(radialAngle) - FORWARD_AMP * 0.5;
    if (uForward < 0.5) directionAngleSDF = -directionAngleSDF;
    float directionAngle = step(directionAngleSDF, 0.0);

    float innerEdgeSDF = abs(len - RADIUS_LOW);
    float outerEdgeSDF = abs(len - RADIUS_HIGH);

    float innerEdgeFill    = step(innerEdgeSDF, EDGES * 0.5);
    float innerEdgeOutline = step(innerEdgeSDF, OUTLINE * 0.5);
    float outerEdgeFill    = step(outerEdgeSDF, EDGES * 0.5) * directionAngle;
    float outerEdgeOutline = step(outerEdgeSDF, OUTLINE * 0.5);

    float edgesFill    = max(innerEdgeFill, outerEdgeFill);
    float edgesOutline = max(innerEdgeOutline, outerEdgeOutline);

    float progressSDF = len - RADIUS_LOW - uProgress * (RADIUS_HIGH - RADIUS_LOW - OUTLINE * 0.5);
    float progressLowSDF = -(len - (RADIUS_LOW + OUTLINE * 0.5));
    progressSDF = max(progressSDF, progressLowSDF);

    float progressFill = step(progressSDF, 0.0);
    float inAngle = (radialAngle > uProgressStartAngle && radialAngle < uProgressEndAngle) ? 1.0 : 0.0;
    progressFill *= inAngle;

    float progressOutline = step(progressSDF, OUTLINE * 0.25) * directionAngle;

    float outline = max(edgesOutline, progressOutline);
    float fill    = max(edgesFill, progressFill);

    if (outline < 0.00001) discard;

    float alpha = (outline * 0.35 + fill * 0.75) * uOpacity;
    vec3 color = mix(uOutlineColor, uFillColor * uColorMultiplier, fill);

    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`

export class Nipple {
  readonly events = new Events<'tap' | 'engage' | 'release'>()

  readonly group = new THREE.Group()
  private mesh: THREE.Mesh
  private material: THREE.ShaderMaterial
  private raycaster = new THREE.Raycaster()
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private intersect = new THREE.Vector3()
  private position = new THREE.Vector3()

  active = false
  animated = false
  /** Heading of the car, radians. */
  angle = 0
  /** 0..1 throttle. */
  progress = 0
  smallestAngle = 0
  targetAngle = 0
  forward = true
  private inRadiusLow = false

  readonly forwardAmplitude = FORWARD_AMPLITUDE

  constructor(private tweens: Tweens) {
    const geometry = new THREE.RingGeometry(
      PROGRESS_RADIUS_LOW - EDGES_THICKNESS - OUTLINE_THICKNESS,
      PROGRESS_RADIUS_HIGH + EDGES_THICKNESS + OUTLINE_THICKNESS,
      48,
      1,
    )
    geometry.rotateX(-Math.PI * 0.5)

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uProgress: { value: 0 },
        uForward: { value: 1 },
        uProgressStartAngle: { value: 0 },
        uProgressEndAngle: { value: 0 },
        uColorMultiplier: { value: 1 },
        uOpacity: { value: 1 },
        uFillColor: { value: new THREE.Color(palette.accent) },
        uOutlineColor: { value: new THREE.Color(palette.ink) },
      },
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.renderOrder = 8
    this.mesh.frustumCulled = false
    this.group.add(this.mesh)
    this.group.visible = false
    this.group.renderOrder = 8
  }

  /** Called every frame with the vehicle's transform. */
  setCoordinates(x: number, y: number, z: number, angle: number): void {
    // Clamped so the ring stays readable when the car is airborne or
    // sunk into a dip, rather than flying off with it.
    const clampedY = clamp(y - 0.25, 0.1, 0.65)
    this.position.set(x, clampedY, z)
    this.group.position.copy(this.position)
    this.plane.constant = -clampedY
    this.angle = angle
    this.mesh.rotation.y = -angle
  }

  /**
   * Folds a pointer event into throttle + bearing. The screen point
   * is unprojected onto the ground plane through the world camera,
   * so dragging maps to where you are actually pointing in the world.
   */
  updateFromPointer(
    pointer: Pointer,
    action: Action,
    camera: THREE.Camera,
    viewport: { width: number; height: number },
  ): void {
    if (action.trigger === 'start') {
      if (pointer.touches.length === 1) {
        this.active = true
        this.events.trigger('engage')
      }
    } else if (action.trigger === 'end') {
      if (this.active && this.inRadiusLow) this.events.trigger('tap')
      if (this.active) this.events.trigger('release')
      this.active = false
      this.inRadiusLow = false
      this.progress = 0
    }

    if (action.trigger !== 'start' && action.trigger !== 'change') return
    if (!this.active) return

    // A second finger means the visitor is panning or pinching the
    // camera, not steering.
    if (pointer.touches.length !== 1) {
      this.active = false
      this.progress = 0
      this.events.trigger('release')
      return
    }

    const ndc = new THREE.Vector2(
      (pointer.current.x / viewport.width) * 2 - 1,
      -((pointer.current.y / viewport.height) * 2 - 1),
    )
    this.raycaster.setFromCamera(ndc, camera)
    if (!this.raycaster.ray.intersectPlane(this.plane, this.intersect)) return

    const distance = this.position.distanceTo(this.intersect)
    this.targetAngle = Math.atan2(
      this.intersect.z - this.position.z,
      this.intersect.x - this.position.x,
    )
    this.progress = clamp(
      (distance - PROGRESS_RADIUS_LOW) / (PROGRESS_RADIUS_HIGH - PROGRESS_RADIUS_LOW),
      0,
      1,
    )
    this.material.uniforms.uProgress.value = this.progress

    if (action.trigger === 'start') {
      if (this.progress === 0) this.inRadiusLow = true
    } else if (this.progress > 0) {
      this.inRadiusLow = false
    }
  }

  /** The hop the ring does when the car jumps. */
  jump(): void {
    this.animated = true
    this.tweens.to(this.mesh.position, { y: 1 }, {
      duration: 0.1,
      ease: easing.power2Out,
      overwrite: true,
      onComplete: () => {
        this.tweens.to(this.mesh.position, { y: 0 }, {
          duration: 0.6,
          ease: easing.power4InOut,
          overwrite: true,
          onComplete: () => {
            this.animated = false
          },
        })
      },
    })
  }

  /** Frame update. Resolves forward/reverse and the progress arc. */
  update(): void {
    if (!this.active && !this.animated) {
      this.group.visible = false
      return
    }

    this.smallestAngle = smallestAngle(this.angle, this.targetAngle)
    const absolute = Math.abs(this.smallestAngle)
    this.forward = absolute < FORWARD_AMPLITUDE / 2
    this.material.uniforms.uForward.value = this.forward ? 1 : 0

    // Behind the car, the bearing is measured from the reverse heading.
    if (!this.forward) {
      this.smallestAngle = smallestAngle(this.angle + Math.PI, this.targetAngle)
    }

    const u = this.material.uniforms
    if (this.forward) {
      u.uProgressStartAngle.value = Math.min(0, this.smallestAngle)
      u.uProgressEndAngle.value = Math.max(0, this.smallestAngle)
    } else if (this.smallestAngle > 0) {
      u.uProgressStartAngle.value = -Math.PI
      u.uProgressEndAngle.value = -Math.PI + this.smallestAngle
    } else {
      u.uProgressStartAngle.value = Math.PI + this.smallestAngle
      u.uProgressEndAngle.value = Math.PI
    }

    u.uColorMultiplier.value = this.progress === 1 ? 1.5 : 1
    this.group.visible = true
  }

  /**
   * Driver intent for the vehicle. Mirrors upstream's Player:
   * throttle is cubed so small drags are gentle, and the steering
   * saturates a quarter-turn off the heading.
   */
  intent(): { accelerating: number; steering: number } | null {
    if (!this.active || this.progress <= 0) return null

    let accelerating = Math.pow(this.progress, 3)
    const deltaAbs = Math.abs(this.smallestAngle)
    const normalised = deltaAbs / ((Math.PI * 2 - FORWARD_AMPLITUDE) / 2)
    let steering = -Math.min(normalised, 1) * Math.sign(this.smallestAngle)

    if (!this.forward) {
      accelerating *= -1
      steering *= -1
    }
    return { accelerating, steering }
  }

  setOpacity(value: number): void {
    this.material.uniforms.uOpacity.value = value
  }

  destroy(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.group.removeFromParent()
    this.events.clear()
  }
}
