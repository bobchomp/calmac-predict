// A tiny external store for React: set() merges a patch and notifies,
// use() subscribes a component (the server render sees the initial state).

import { useSyncExternalStore } from 'react';

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  return {
    get: () => state,
    set(patch) { state = { ...state, ...patch }; listeners.forEach(l => l()); },
    use: () => useSyncExternalStore(subscribe, () => state, () => initial),
  };
}
