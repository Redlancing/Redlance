"use client";

import { useEffect, useRef } from "react";

// Line-art scenes for the Alerts section, modelled on Attio's Signals canvas:
// thin off-white lines on dark, a few moving particles, and one orange
// "Redlance moment" per scene. SVG + SMIL so they stay sharp and light;
// animations are paused while off screen and omitted with reduced motion.

type SceneProps = { playing: boolean; animate: boolean };

function useSvgPlayback(playing: boolean) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    if (playing) svg.unpauseAnimations();
    else svg.pauseAnimations();
  }, [playing]);
  return ref;
}

const line = "stroke-bone/20";
const faint = "stroke-bone/12";

/* Telegram: a signal travels in and an orange ping ripples out. */
export function RadarScene({ playing, animate }: SceneProps) {
  const ref = useSvgPlayback(playing);
  const dur = "3.2s";
  return (
    <svg
      ref={ref}
      viewBox="-320 -360 640 720"
      className="size-full p-6"
      fill="none"
    >
      {[55, 115, 175, 235, 295].map((r) => (
        <circle key={r} r={r} className={line} strokeWidth="1" />
      ))}
      {[
        [-320, 0, 320, 0],
        [0, -360, 0, 360],
        [-260, -260, 260, 260],
        [-260, 260, 260, -260],
      ].map(([x1, y1, x2, y2]) => (
        <line
          key={`${x1}${y1}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          className={faint}
          strokeDasharray="3 7"
        />
      ))}
      <line x1="0" y1="-360" x2="0" y2="-60" className="stroke-bone/30" />
      <circle r="6" className="fill-bone" />
      {animate && (
        <>
          <circle r="3" className="fill-bone">
            <animateMotion
              path="M0 -340 V-6"
              keyPoints="0;1;1"
              keyTimes="0;0.45;1"
              calcMode="linear"
              dur={dur}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0;0"
              keyTimes="0;0.06;0.42;0.46;1"
              dur={dur}
              repeatCount="indefinite"
            />
          </circle>
          {[
            ["0;0.45;1", 220],
            ["0;0.55;1", 150],
          ].map(([times, to]) => (
            <circle
              key={String(to)}
              r="6"
              className="stroke-flare-500"
              strokeWidth="1.5"
            >
              <animate
                attributeName="r"
                values={`6;6;${to}`}
                keyTimes={String(times)}
                dur={dur}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0;0.9;0"
                keyTimes={String(times)}
                dur={dur}
                repeatCount="indefinite"
              />
            </circle>
          ))}
          <circle r="6" className="fill-flare-500">
            <animate
              attributeName="opacity"
              values="0;0;1;0"
              keyTimes="0;0.44;0.5;0.85"
              dur={dur}
              repeatCount="indefinite"
            />
          </circle>
        </>
      )}
    </svg>
  );
}

/* Daily digest: matches orbit, today's best one glows orange. */
const orbits = [70, 130, 190, 250, 310];
const ellipsePath = (rx: number, ry: number) =>
  `M${-rx} 0 a${rx} ${ry} 0 1 0 ${2 * rx} 0 a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;

export function OrbitScene({ playing, animate }: SceneProps) {
  const ref = useSvgPlayback(playing);
  return (
    <svg
      ref={ref}
      viewBox="-340 -360 680 720"
      className="size-full p-6"
      fill="none"
    >
      <g transform="rotate(-14)">
        {orbits.map((rx) => (
          <ellipse key={rx} rx={rx} ry={rx * 0.42} className={line} />
        ))}
        <ellipse rx="336" ry="150" className={faint} strokeDasharray="4 6" />
        <circle r="46" className="stroke-bone/40" />
        {animate &&
          orbits.map((rx, i) => (
            <circle
              key={rx}
              r={i === 1 ? 5 : 2.5}
              className={i === 1 ? "fill-flare-500" : "fill-bone"}
            >
              <animateMotion
                path={ellipsePath(rx, rx * 0.42)}
                dur={`${9 + i * 3.5}s`}
                begin={`${-i * 2.3}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
        {animate &&
          [130, 250].map((rx, i) => (
            <circle key={`b${rx}`} r="2.5" className="fill-bone/70">
              <animateMotion
                path={ellipsePath(rx, rx * 0.42)}
                dur={`${14 + i * 4}s`}
                begin={`${-6 - i * 3}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
      </g>
    </svg>
  );
}
