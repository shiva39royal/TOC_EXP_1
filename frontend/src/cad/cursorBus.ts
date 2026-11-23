type Fn = (x: number | null, y: number | null) => void;
const subs = new Set<Fn>();
/** Cursor coordinates change on every mouse move; they bypass React/Zustand on purpose. */
export const cursorBus = {
  emit: (x: number | null, y: number | null) => subs.forEach((f) => f(x, y)),
  subscribe: (f: Fn) => { subs.add(f); return () => { subs.delete(f); }; },
};
