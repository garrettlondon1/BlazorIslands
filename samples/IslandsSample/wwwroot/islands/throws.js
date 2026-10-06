// Fails during mount: the island must fall back to its server-rendered content without affecting other islands.
export function mount() {
  throw new Error('This island throws on purpose.');
}
