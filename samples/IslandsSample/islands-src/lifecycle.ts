// Counts each framework's own mount/unmount hooks, so the tests prove the framework cleaned up, not just the runtime.
export interface Lifecycle {
  mounts: number;
  unmounts: number;
}

export function lifecycle(framework: string): Lifecycle {
  const all = ((globalThis as { __cards?: Record<string, Lifecycle> }).__cards ??= {});
  return (all[framework] ??= { mounts: 0, unmounts: 0 });
}
