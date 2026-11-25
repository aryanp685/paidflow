"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Check, Layers3 } from "lucide-react";

export function AuthFrame({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const float = reduced
    ? {}
    : { y: [0, -8, 0], transition: { duration: 6, repeat: Infinity, ease: "easeInOut" as const } };
  return (
    <main className="auth-layout">
      <section className="auth-main">
        <Link className="auth-logo" href="/">
          <span>p.</span>paidflow<b>.</b>
        </Link>
        <div className="auth-content">{children}</div>
        <div className="auth-footer">
          © {new Date().getFullYear()} PAIDFLOW <span>Built for a little more clarity.</span>
        </div>
      </section>
      <aside className="auth-aside">
        <div className="auth-aside-top">
          THE RECEIVABLES WORKSPACE <ArrowUpRight size={15} />
        </div>
        <div className="auth-aside-inner">
          <div className="auth-abstract">
            <motion.div
              className="auth-abstract-card"
              initial={reduced ? false : { opacity: 0, y: 16, rotate: -1.5 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <span>
                <Layers3 size={18} />
              </span>
              <small>ONE CLEARER PICTURE</small>
              <strong>
                From invoice
                <br />
                to follow-up.
              </strong>
              <div className="auth-lines">
                <i />
                <i />
                <i />
              </div>
            </motion.div>
            <motion.div
              initial={reduced ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <motion.div className="auth-floating" animate={float}>
                <Check size={15} /> Everything in its place
              </motion.div>
            </motion.div>
          </div>
          <motion.h2
            initial={reduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            Make room for
            <br />
            <span>better flow.</span>
          </motion.h2>
          <p>
            A more thoughtful way to keep track of the work you’ve done and the
            payments you’re expecting.
          </p>
          <div className="auth-aside-caption">
            DESIGNED FOR INDIAN BUSINESSES &nbsp; ✳
          </div>
        </div>
      </aside>
    </main>
  );
}