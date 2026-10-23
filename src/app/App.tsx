import { useEffect, useRef } from "react";
import { AssetsView } from "../features/assets/AssetsView";
import { CowriterPanel } from "../features/cowriter/CowriterPanel";
import { EditorView } from "../features/editor/EditorView";
import { LibraryView } from "../features/library/LibraryView";
import { LorebookView } from "../features/lorebook/LorebookView";
import { Icon } from "../components/Icon";
import { Toaster } from "../components/toast";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SECTIONS, type SectionId } from "./sections";
import { useUi } from "./store";

const VIEWS: Record<Exclude<SectionId, "cowriter">, () => React.JSX.Element> = {
  library: LibraryView,
  editor: EditorView,
  lorebook: LorebookView,
  assets: AssetsView,
};

/**
 * Responsive shell.
 * - Phone (< md): content + bottom tab bar, co-writer is a tab.
 * - Tablet (md): left nav rail, co-writer is a rail item.
 * - Desktop (lg+): left nav rail, co-writer docked on the right.
 */
export default function App() {
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);
  const mainRef = useRef<HTMLElement>(null);

  // Each section starts at the top instead of keeping the previous section's scroll position.
  useEffect(() => mainRef.current?.scrollTo?.({ top: 0 }), [section]);

  // On large screens the co-writer is always docked, so the main area falls back to the editor.
  const MainView = section === "cowriter" ? EditorView : VIEWS[section];

  return (
    <div className="flex h-full flex-col md:flex-row">
      <header className="pt-safe flex items-center gap-2 border-b border-border bg-surface-raised px-4 md:hidden">
        <img src="/icon.svg" alt="" className="size-6" />
        <span className="py-3 font-semibold">CardForge</span>
      </header>

      <nav
        aria-label="Sections"
        className="hidden w-20 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface-raised py-4 md:flex"
      >
        <img src="/icon.svg" alt="CardForge" className="mb-4 size-8" />
        {SECTIONS.map((s) => (
          <NavButton
            key={s.id}
            label={s.label}
            icon={s.icon}
            active={section === s.id}
            onClick={() => setSection(s.id)}
            className={s.id === "cowriter" ? "lg:hidden" : undefined}
          />
        ))}
      </nav>

      <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto">
        <ErrorBoundary key={section} onReset={() => setSection("library")}>
          {section === "cowriter" ? (
            <>
              <div className="lg:hidden">
                <CowriterPanel />
              </div>
              <div className="hidden lg:block">
                <MainView />
              </div>
            </>
          ) : (
            <MainView />
          )}
        </ErrorBoundary>
      </main>

      <aside
        aria-label="Co-writer"
        className="hidden w-96 shrink-0 overflow-y-auto border-l border-border bg-surface-sunken lg:block"
      >
        <CowriterPanel />
      </aside>

      <nav
        aria-label="Sections"
        className="pb-safe grid grid-cols-5 border-t border-border bg-surface-raised md:hidden"
      >
        {SECTIONS.map((s) => (
          <NavButton
            key={s.id}
            label={s.label}
            icon={s.icon}
            active={section === s.id}
            onClick={() => setSection(s.id)}
          />
        ))}
      </nav>
      <Toaster />
    </div>
  );
}

interface NavButtonProps {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}

function NavButton({ label, icon, active, onClick, className = "" }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] transition-colors md:w-16 ${
        active ? "text-accent md:bg-accent/10" : "text-ink-muted hover:text-ink"
      } ${className}`}
    >
      <Icon path={icon} />
      {label}
    </button>
  );
}
