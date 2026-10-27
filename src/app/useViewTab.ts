import { useEffect, useState } from "react";
import type { SectionId } from "./sections";
import { useUi } from "./store";

/** A section's tab, which other screens can open it on with `goTo(section, tab)`. */
export function useViewTab<T extends string>(section: SectionId, initial: T): [T, (tab: T) => void] {
  const [tab, setTab] = useState<T>(() => {
    const request = useUi.getState().tabRequest;
    return request?.section === section ? (request.tab as T) : initial;
  });
  const request = useUi((s) => s.tabRequest);
  useEffect(() => {
    if (request?.section !== section) return;
    setTab(request.tab as T);
    useUi.getState().takeTabRequest();
  }, [request, section]);
  return [tab, setTab];
}
