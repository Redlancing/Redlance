"use client";

import { useEffect, useRef } from "react";

/*
 * The "match feed" funnel: a small 3D renderer modelled on the funnel scene in
 * Attio's Signals block (measured 2026-09-25, see docs/research/attio-teardown.md).
 *
 * A gravity-well surface is sampled into rings and spokes, projected through a
 * perspective camera, depth-faded, and drawn back to front with the surface
 * filled in the background colour so near parts hide far lines. Particles
 * slide down the spokes with a soft trail and glowing head.
 */

type Vec3 = [number, number, number];
type Projected = { x: number; y: number; z: number; fade: number };

const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, v: number) => {
  const t = clamp((v - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

// Surface: depth parameter `d` (rim at 0, throat at 1), angle `a`.
const DEPTH = 7.5;
const wellRadius = (d: number) => 3.2 * (1 - Math.min(d, 1)) ** 3.2;
const wellPoint = (d: number, a: number): Vec3 => {
  const r = wellRadius(d);
  return [r * Math.cos(a), -(DEPTH * clamp(d, 0, 1) ** 2.2), r * Math.sin(a)];
};
// Eases the spoke/fill sampling so detail bunches near the rim.
const spokeDepth = (t: number) => -0.2 + 1.2 * (1 - (1 - t) * (1 - t));
const RING_DEPTHS = [
  -0.2, -0.12, -0.05, 0.04, 0.12, 0.22, 0.33, 0.45, 0.57, 0.68, 0.78, 0.87,
  0.94,
];
const SPOKES = 16;
const PARTICLES = 12;
const PARTICLE_SPEED = 0.07; // depth units per second
const TRAIL = 0.13;

// Camera for the funnel view.
const ELEVATION = 52; // degrees
const DISTANCE = 6.6;
const FOCUS = 1.2;
const POINTER_TILT = 3.5; // degrees

type Colors = { line: number[]; bg: number[]; trail: string; head: string };

type Item =
  | { kind: "fill"; depth: number; pts: Projected[] }
  | {
      kind: "line";
      depth: number;
      a: Projected;
      b: Projected;
      alpha: number;
      rgb: string;
    }
  | {
      kind: "particle";
      depth: number;
      head: Projected;
      angle: number;
      progress: number;
    };

function backgroundOf(el: HTMLElement | null): number[] {
  for (let node = el; node; node = node.parentElement) {
    const m = getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
    if (m && (m.length < 4 || +m[3] > 0)) return m.slice(0, 3).map(Number);
  }
  return [26, 21, 18];
}

export function FunnelCanvas({
  playing,
  animate,
  lineRgb = "156,147,139",
  trailRgb = "255,176,140",
}: {
  playing: boolean;
  animate: boolean;
  lineRgb?: string;
  trailRgb?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  const syncRef = useRef<() => void>(() => {});

  // Start or stop the render loop when visibility changes.
  useEffect(() => {
    playingRef.current = playing;
    syncRef.current();
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;

    let width = 1;
    let height = 1;
    const resize = () => {
      // Layout size, not getBoundingClientRect: the scene fades in with a
      // scale transform, which must not shrink the drawing buffer.
      width = Math.max(1, host.clientWidth);
      height = Math.max(1, host.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const colors: Colors = {
      line: lineRgb.split(",").map(Number),
      bg: backgroundOf(host),
      trail: trailRgb,
      head: "255,255,255",
    };
    // Deeper rings blend toward the background (33 precomputed steps).
    const ringShades = Array.from({ length: 33 }, (_, i) =>
      colors.line
        .map((c, k) => Math.round(lerp(c, colors.bg[k], (i / 32) * 0.9)))
        .join(","),
    );
    const shadeAt = (d: number) =>
      ringShades[Math.round(32 * smoothstep(0.15, 0.75, d))];
    const fillStyle = `rgb(${colors.bg.join(",")})`;

    // Pointer tilt (desktop, fine pointer, motion allowed).
    const finePointer = window.matchMedia(
      "(hover: hover) and (pointer: fine) and (min-width: 1024px)",
    );
    let pointerY = 0;
    let pointerOn = 0;
    let smoothY = 0;
    let smoothOn = 0;
    const onMove = (e: PointerEvent) => {
      if (!finePointer.matches || !animate) return;
      const rect = host.getBoundingClientRect();
      pointerY = clamp(
        (e.clientY - rect.top - rect.height / 2) / (rect.height / 2),
        -1,
        1,
      );
      pointerOn = 1;
    };
    const onLeave = () => {
      pointerY = 0;
      pointerOn = 0;
    };

    const draw = (time: number, dt: number) => {
      const ease = 1 - Math.exp(-dt / 0.18);
      smoothY += (pointerY - smoothY) * ease;
      smoothOn += (pointerOn - smoothOn) * ease;

      // Camera
      const focal = 0.92 * height;
      const cx = 0.5 * width;
      const cy = 0.5 * height;
      const elev =
        ((ELEVATION + POINTER_TILT * smoothY * smoothOn) * Math.PI) / 180;
      const target: Vec3 = [0, -FOCUS, 0];
      const eye: Vec3 = [
        0,
        -FOCUS + DISTANCE * Math.cos(elev),
        DISTANCE * Math.sin(elev),
      ];
      const fwd = normalize([
        target[0] - eye[0],
        target[1] - eye[1],
        target[2] - eye[2],
      ]);
      const right = normalize(cross(fwd, [0, 0, 1]));
      const up = cross(fwd, right);
      const fadeNear = 0.32 * DISTANCE;
      const fadeFar = DISTANCE + 9.3;

      const project = (p: Vec3): Projected | null => {
        const dx = p[0] - eye[0];
        const dy = p[1] - eye[1];
        const dz = p[2] - eye[2];
        const z = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
        if (z <= 0.05) return null;
        const s = focal / z;
        return {
          x: cx + (dx * right[0] + dy * right[1] + dz * right[2]) * s,
          y: cy - (dx * up[0] + dy * up[1] + dz * up[2]) * s,
          z,
          fade: 0.1 + 0.9 * (1 - smoothstep(fadeNear, fadeFar, z)),
        };
      };
      const ring = (d: number) =>
        Array.from({ length: 49 }, (_, i) =>
          project(wellPoint(d, (i / 48) * TAU)),
        );

      const items: Item[] = [];
      const pushLine = (
        a: Projected | null,
        b: Projected | null,
        alpha: number,
        rgb: string,
      ) => {
        if (a && b && alpha > 0.004)
          items.push({
            kind: "line",
            a,
            b,
            alpha,
            rgb,
            depth: (a.z + b.z) / 2 - 0.6,
          });
      };

      // 1. Surface bands, filled in the background colour to occlude.
      let prev: (Projected | null)[] | null = null;
      for (let s = 0; s < 24; s++) {
        const d0 = spokeDepth(s / 24);
        if (wellRadius(d0) < 0.02) break;
        const a = prev ?? ring(d0);
        const b = ring(spokeDepth((s + 1) / 24));
        for (let i = 0; i < 48; i++) {
          const p0 = a[i],
            p1 = b[i],
            p2 = b[i + 1],
            p3 = a[i + 1];
          if (p0 && p1 && p2 && p3)
            items.push({
              kind: "fill",
              pts: [p0, p1, p2, p3],
              depth: (p0.z + p1.z + p2.z + p3.z) / 4,
            });
        }
        prev = b;
      }

      // 2. Rings
      for (const d of RING_DEPTHS) {
        const base = 0.5 * smoothstep(-0.2, 0.28, d);
        const rgb = shadeAt(d);
        let last = project(wellPoint(d, 0));
        for (let i = 1; i <= 96; i++) {
          const next = project(wellPoint(d, (i / 96) * TAU));
          if (last && next)
            pushLine(last, next, base * ((last.fade + next.fade) / 2), rgb);
          last = next;
        }
      }

      // 3. Spokes
      for (let k = 0; k < SPOKES; k++) {
        const angle = (k / SPOKES) * TAU;
        let d0 = spokeDepth(0);
        let last = project(wellPoint(d0, angle));
        let w0 = smoothstep(-0.26, 0, d0);
        for (let i = 1; i <= 56; i++) {
          const d1 = spokeDepth(i / 56);
          const next = project(wellPoint(d1, angle));
          const w1 = smoothstep(-0.26, 0, d1);
          if (last && next)
            pushLine(
              last,
              next,
              0.42 * ((last.fade * w0 + next.fade * w1) / 2),
              shadeAt((d0 + d1) / 2),
            );
          last = next;
          d0 = d1;
          w0 = w1;
        }
      }

      // 4. Particles sliding down the spokes
      for (let s = 0; s < PARTICLES; s++) {
        const angle = (((5 * s) % SPOKES) / SPOKES) * TAU;
        const progress = (PARTICLE_SPEED * time + s / PARTICLES) % 1;
        const head = project(wellPoint(progress, angle));
        if (head)
          items.push({
            kind: "particle",
            head,
            angle,
            progress,
            depth: head.z - 0.6,
          });
      }

      // Back to front
      items.sort((a, b) => b.depth - a.depth);

      ctx.clearRect(0, 0, width, height);
      ctx.lineJoin = "round";
      ctx.lineCap = "butt";
      ctx.fillStyle = fillStyle;
      let lastStroke = "";

      for (const item of items) {
        if (item.kind === "fill") {
          ctx.beginPath();
          ctx.moveTo(item.pts[0].x, item.pts[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(item.pts[i].x, item.pts[i].y);
          ctx.closePath();
          ctx.fill();
        } else if (item.kind === "line") {
          const style = `rgba(${item.rgb},${item.alpha.toFixed(3)})`;
          if (style !== lastStroke) {
            ctx.strokeStyle = style;
            lastStroke = style;
          }
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(item.a.x, item.a.y);
          ctx.lineTo(item.b.x, item.b.y);
          ctx.stroke();
        } else {
          drawParticle(item.head, item.angle, item.progress);
          lastStroke = "";
          ctx.fillStyle = fillStyle;
        }
      }

      // Fade the top and bottom edges
      ctx.globalCompositeOperation = "destination-in";
      const mask = ctx.createLinearGradient(0, 0, 0, height);
      mask.addColorStop(0, "rgba(0,0,0,0)");
      mask.addColorStop(0.2, "rgba(0,0,0,1)");
      mask.addColorStop(0.9, "rgba(0,0,0,1)");
      mask.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = mask;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";

      function drawParticle(head: Projected, angle: number, p: number) {
        ctx!.globalCompositeOperation = "lighter";
        // Trail
        const pts: Projected[] = [];
        for (let i = 0; i <= 10; i++) {
          const d = p - (i / 10) * TRAIL;
          if (d <= 0) break;
          const q = project(wellPoint(d, angle));
          if (!q) break;
          pts.push(q);
        }
        if (pts.length >= 2) {
          const n = pts.length - 1;
          const g = ctx!.createLinearGradient(
            pts[0].x,
            pts[0].y,
            pts[n].x,
            pts[n].y,
          );
          pts.forEach((q, i) => {
            const t = 1 - i / n;
            g.addColorStop(
              i / n,
              `rgba(${colors.trail},${0.6 * t * t * q.fade})`,
            );
          });
          ctx!.strokeStyle = g;
          ctx!.lineWidth = 1.6;
          ctx!.beginPath();
          ctx!.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx!.lineTo(pts[i].x, pts[i].y);
          ctx!.stroke();
        }
        // Head: soft glow + bright core, shrinking and dimming with depth
        const shrink = 1 - 0.5 * p;
        const dim = 1 - 0.9 * p * p * p;
        glow(head.x, head.y, 5 * shrink, colors.trail, 0.13 * dim * head.fade);
        glow(head.x, head.y, 2.4 * shrink, colors.head, 0.95 * head.fade);
        ctx!.globalCompositeOperation = "source-over";
      }
      function glow(
        x: number,
        y: number,
        r: number,
        rgb: string,
        alpha: number,
      ) {
        if (alpha <= 0.004 || r <= 0) return;
        const g = ctx!.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${rgb},${alpha})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.arc(x, y, r, 0, TAU);
        ctx!.fill();
      }
    };

    let raf = 0;
    let last = 0;
    let clock = 0;
    const frame = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      clock += dt;
      draw(clock, dt);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf || !animate) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const sync = () =>
      playingRef.current && !document.hidden ? start() : stop();

    // A still frame straight away (and the only frame with reduced motion).
    draw(3, 0.016);
    syncRef.current = sync;
    sync();

    const ro = new ResizeObserver(() => {
      resize();
      if (!raf) draw(clock || 3, 0.016);
    });
    ro.observe(host);
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", sync);

    return () => {
      stop();
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", sync);
      syncRef.current = () => {};
    };
  }, [animate, lineRgb, trailRgb]);

  return (
    <div className="relative size-full">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 block size-full"
      />
    </div>
  );
}
