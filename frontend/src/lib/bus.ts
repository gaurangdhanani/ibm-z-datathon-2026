/** "Something changed, refetch" signal. Mock mode fires it on mutations, background tagging and
 *  other tabs' writes; VLT-9 will fire it from the SSE streams. */
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitChange(): void {
  listeners.forEach((listener) => listener());
}
