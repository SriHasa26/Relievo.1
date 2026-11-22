// Small hooks for the landing page: scroll reveal and "simple mode" detection.
import { useEffect, useRef, useState } from "react";

const mq = (q: string) => typeof window !== "undefined" && window.matchMedia?.(q).matches;

/** True when the heavy scroll-driven 3D should be replaced by a plain layout: touch, small screens, reduced motion. */
export function useSimpleMode() {
  const get = () => mq("(prefers-reduced-motion: reduce)") || mq("(max-width: 767px)") || !mq("(hover: hover) and (pointer: fine)");
  const [simple, setSimple] = useState(get);
  useEffect(() => {
    const on = () => setSimple(get());
    const qs = ["(prefers-reduced-motion: reduce)", "(max-width: 767px)", "(hover: hover) and (pointer: fine)"].map((q) => window.matchMedia(q));
    qs.forEach((m) => m.addEventListener("change", on));
    return () => qs.forEach((m) => m.removeEventListener("change", on));
  }, []);
  return simple;
}

/** Adds the `in` class once the element scrolls into view (CSS .reveal). */
export function useReveal<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) { el.classList.add("in"); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) { el.classList.add("in"); io.disconnect(); }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return ref;
}

/** True while the element is mostly on screen (used to start the chat demo). */
export function useInView<T extends HTMLElement>(threshold = 0.35) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => setSeen(Boolean(e?.isIntersecting)), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}
