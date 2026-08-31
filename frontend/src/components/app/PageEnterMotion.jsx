import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export const pageEnterMotionProps = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
};

/** Opacity-only — avoids a lingering transform that breaks position:sticky. */
export const pageEnterFadeProps = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
};

/**
 * Wraps a full route tree (e.g. login) with the standard page enter animation.
 */
export default function PageEnterMotion({ children, className, fadeOnly = false }) {
  return (
    <motion.div
      {...(fadeOnly ? pageEnterFadeProps : pageEnterMotionProps)}
      className={cn("h-full min-h-0 w-full", className)}
    >
      {children}
    </motion.div>
  );
}
