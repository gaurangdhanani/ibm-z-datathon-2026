/** VLT-9: one EventSource per signed-in shell. Every `change` event pokes the data bus, so each
 *  open screen refetches (useResource). The browser reconnects on its own if the stream drops. */
import { useEffect } from "react";

import { emitChange } from "./bus";

export function useLiveEvents(path: string | null): void {
  useEffect(() => {
    if (!path || typeof EventSource === "undefined") return;
    const source = new EventSource(path, { withCredentials: true });
    source.addEventListener("change", () => emitChange());
    return () => source.close();
  }, [path]);
}
