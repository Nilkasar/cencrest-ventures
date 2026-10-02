"use client";

import { useEffect, useState } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";

/**
 * The snapshot page's hero visual — four AI models are queried in turn, a
 * signal travels from the active model into the AI Visibility Score dial.
 *
 * Choreography is one shared 6.4s cycle: each model's comet runs on the
 * same CSS timeline (`sf-travel`, per-path delay `i * STEP_MS`), and the
 * highlighted node is set from that comet's own animationstart/iteration
 * events — so highlight and signal cannot drift apart, and there is no
 * per-frame JS. Everything continuous is CSS, so the global
 * `prefers-reduced-motion` rule in tokens.css stops it; the Framer parts are
 * governed by `<MotionConfig reducedMotion="user">` in `UIProvider`.
 *
 * The dial value is a labelled sample, not a claim about the visitor.
 */

const MODELS = [
  { name: "ChatGPT", vendor: "OpenAI", glyph: "G", tint: "#10a37f" },
  { name: "Claude", vendor: "Anthropic", glyph: "C", tint: "#d97757" },
  { name: "Gemini", vendor: "Google", glyph: "G", tint: "#4f8df5" },
  { name: "Perplexity", vendor: "Perplexity AI", glyph: "P", tint: "#3fb6c6" },
] as const;

const STEP_MS = 1600;
const SAMPLE_SCORE = 72;

const NODE_W = 176;
const NODE_H = 48;
const NODE_Y = [42, 112, 182, 252] as const; // top edge of each node
const DIAL = { cx: 446, cy: 170, r: 62 };
const TICKS = 60;

/** Server and client Math.sin/cos can differ in the last float digit,
 *  which is a hydration mismatch — round every tick coordinate. */
const r2 = (n: number) => Math.round(n * 100) / 100;
const TICK_GEOMETRY = Array.from({ length: TICKS }, (_, t) => {
  const a = (t / TICKS) * Math.PI * 2 - Math.PI / 2;
  const major = t % 5 === 0;
  const inner = DIAL.r + 12;
  const outer = DIAL.r + (major ? 20 : 16);
  return {
    major,
    x1: r2(DIAL.cx + Math.cos(a) * inner),
    y1: r2(DIAL.cy + Math.sin(a) * inner),
    x2: r2(DIAL.cx + Math.cos(a) * outer),
    y2: r2(DIAL.cy + Math.sin(a) * outer),
  };
});

function nodeCenterY(i: number) {
  return NODE_Y[i]! + NODE_H / 2;
}

function pathFor(i: number) {
  const y = nodeCenterY(i);
  const endX = DIAL.cx - DIAL.r - 18;
  return `M${NODE_W} ${y} C ${NODE_W + 96} ${y}, ${endX - 92} ${DIAL.cy}, ${endX} ${DIAL.cy}`;
}

export function SnapshotSignalField({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  // Starts at 0 on server and client alike (reduced-motion is unknown during
  // SSR, so branching on it here would be a hydration mismatch); a reduced-
  // motion visitor gets the final value on the first frame instead.
  const [score, setScore] = useState(0);

  useEffect(() => {
    const controls = animate(0, SAMPLE_SCORE, {
      duration: reduce ? 0 : 2.2,
      delay: reduce ? 0 : 0.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setScore(Math.round(v)),
    });
    return () => controls.stop();
  }, [reduce]);

  return (
    <svg
      viewBox="0 0 560 340"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Illustration: ChatGPT, Claude, Gemini and Perplexity are queried and their answers roll up into one AI Visibility Score."
    >
      <defs>
        <radialGradient id="sf-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5c9c78" stopOpacity="0.32" />
          <stop offset="60%" stopColor="#5c9c78" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#5c9c78" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sf-wire" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f4f2ec" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#5c9c78" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id="sf-arc" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#3e7f5c" />
          <stop offset="100%" stopColor="#86b899" />
        </linearGradient>
        <filter id="sf-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* Ambient glow behind the dial */}
      <circle className="sf-breathe" cx={DIAL.cx} cy={DIAL.cy} r="150" fill="url(#sf-glow)" />

      {/* Wires + comets */}
      {MODELS.map((m, i) => {
        const d = pathFor(i);
        const isActive = i === active;
        return (
          <g key={`wire-${m.name}`}>
            <path
              d={d}
              stroke="url(#sf-wire)"
              strokeWidth="1"
              style={{ opacity: isActive ? 1 : 0.55, transition: "opacity 600ms var(--ease-standard)" }}
            />
            <path
              d={d}
              pathLength={100}
              className="sf-comet"
              stroke="#86b899"
              strokeWidth="4"
              strokeLinecap="round"
              filter="url(#sf-blur)"
              style={{ animationDelay: `${i * STEP_MS}ms` }}
            />
            <path
              d={d}
              pathLength={100}
              className="sf-comet"
              stroke="#eef5f0"
              strokeWidth="1.6"
              strokeLinecap="round"
              style={{ animationDelay: `${i * STEP_MS}ms` }}
              onAnimationStart={() => setActive(i)}
              onAnimationIteration={() => setActive(i)}
            />
          </g>
        );
      })}

      {/* Model nodes */}
      {MODELS.map((m, i) => {
        const y = NODE_Y[i]!;
        const cy = nodeCenterY(i);
        const isActive = i === active;
        return (
          <motion.g
            key={m.name}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.25 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
          >
            <rect
              x="0.5"
              y={y + 0.5}
              width={NODE_W - 1}
              height={NODE_H - 1}
              rx="11"
              fill={isActive ? "#1d241d" : "#1a1612"}
              stroke={isActive ? "#5c9c78" : "#f4f2ec"}
              strokeOpacity={isActive ? 0.7 : 0.1}
              style={{ transition: "all 500ms var(--ease-standard)" }}
            />
            <circle cx="25" cy={cy} r="12" fill={m.tint} fillOpacity="0.16" stroke={m.tint} strokeOpacity="0.55" />
            <text
              x="25"
              y={cy + 4}
              textAnchor="middle"
              fill={m.tint}
              fontSize="11"
              fontWeight="700"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {m.glyph}
            </text>
            <text x="47" y={cy - 3} fill="#f4f2ec" fontSize="12.5" fontWeight="600" style={{ fontFamily: "var(--font-sans)" }}>
              {m.name}
            </text>
            <text x="47" y={cy + 12} fill="#a89c81" fontSize="9.5" style={{ fontFamily: "var(--font-sans)" }}>
              {m.vendor}
            </text>
            {/* status dot */}
            <circle
              cx={NODE_W - 18}
              cy={cy}
              r="3"
              fill={isActive ? "#86b899" : "#f4f2ec"}
              fillOpacity={isActive ? 1 : 0.18}
              style={{ transition: "all 400ms var(--ease-standard)" }}
            />
            {isActive && <circle className="sf-ping" cx={NODE_W - 18} cy={cy} r="3" fill="#86b899" />}
          </motion.g>
        );
      })}

      {/* Dial */}
      <motion.g
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformOrigin: `${DIAL.cx}px ${DIAL.cy}px` }}
      >
        {/* slow orbit */}
        <circle
          className="sf-orbit"
          cx={DIAL.cx}
          cy={DIAL.cy}
          r={DIAL.r + 32}
          stroke="#f4f2ec"
          strokeOpacity="0.12"
          strokeDasharray="1 7"
          strokeLinecap="round"
        />
        {/* instrument ticks */}
        {TICK_GEOMETRY.map(({ major, x1, y1, x2, y2 }, t) => {
          const lit = t / TICKS < score / 100;
          return (
            <line
              key={t}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={lit ? "#86b899" : "#f4f2ec"}
              strokeOpacity={lit ? (major ? 0.9 : 0.55) : 0.12}
              strokeWidth={major ? 1.4 : 1}
              strokeLinecap="round"
            />
          );
        })}
        {/* arrival ping, timed to each comet landing */}
        <circle className="sf-arrive" cx={DIAL.cx} cy={DIAL.cy} r={DIAL.r} stroke="#86b899" strokeWidth="1.5" />
        {/* track + value */}
        <circle cx={DIAL.cx} cy={DIAL.cy} r={DIAL.r} fill="#16120d" stroke="#f4f2ec" strokeOpacity="0.08" strokeWidth="6" />
        <circle
          cx={DIAL.cx}
          cy={DIAL.cy}
          r={DIAL.r}
          stroke="url(#sf-arc)"
          strokeWidth="6"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${score} 100`}
          transform={`rotate(-90 ${DIAL.cx} ${DIAL.cy})`}
        />
        <text
          x={DIAL.cx}
          y={DIAL.cy + 9}
          textAnchor="middle"
          fill="#faf9f6"
          fontSize="40"
          fontWeight="600"
          style={{ fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}
        >
          {score}
        </text>
        <text
          x={DIAL.cx}
          y={DIAL.cy + 28}
          textAnchor="middle"
          fill="#a89c81"
          fontSize="10"
          letterSpacing="0.06em"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          / 100
        </text>
        <text
          x={DIAL.cx}
          y={DIAL.cy + DIAL.r + 58}
          textAnchor="middle"
          fill="#f4f2ec"
          fillOpacity="0.72"
          fontSize="9.5"
          letterSpacing="0.16em"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          AI VISIBILITY SCORE
        </text>
        <text
          x={DIAL.cx}
          y={DIAL.cy + DIAL.r + 74}
          textAnchor="middle"
          fill="#a89c81"
          fillOpacity="0.7"
          fontSize="8.5"
          letterSpacing="0.14em"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          SAMPLE
        </text>
      </motion.g>
    </svg>
  );
}
