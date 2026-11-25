"use client";

import { motion, useReducedMotion } from "framer-motion";

export function LoadingScreen({ label = "Getting things ready" }: { label?: string }) {
  const reduced = useReducedMotion();
  return (
    <div
      className="loading-screen"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="loading-screen-inner">
        <motion.div
          className="loading-mark"
          initial={reduced ? false : { scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path
              d="M7 23.5V8.5h9.3c4.1 0 6.7 2.2 6.7 5.8 0 3.5-2.6 5.8-6.7 5.8H12"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M17 25h8M22 22l3 3-3 3"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.div>
        <div className="loading-word">
          paidflow<span>.</span>
        </div>
        <div className="loading-bar" aria-hidden="true">
          <motion.span
            initial={reduced ? { scaleX: 1 } : { scaleX: 0.15 }}
            animate={reduced ? { scaleX: 1 } : { scaleX: [0.15, 0.85, 0.15] }}
            transition={
              reduced
                ? undefined
                : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
            }
          />
        </div>
        <span className="loading-label">{label}</span>
      </div>
    </div>
  );
}