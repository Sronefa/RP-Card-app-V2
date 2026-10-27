import { useEffect, useRef } from "react";
import { AssetsView } from "../features/assets/AssetsView";
import { CowriterPanel } from "../features/cowriter/CowriterPanel";
import { EditorView } from "../features/editor/EditorView";
import { LibraryView } from "../features/library/LibraryView";
import { LorebookView } from "../features/lorebook/LorebookView";
import { SettingsView } from "../features/settings/SettingsView";
import { TrackersView } from "../features/trackers/TrackersView";
import { EngineView } from "../features/engine/EngineView";
import { Icon } from "../components/Icon";
import { Toaster } from "../components/toast";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SECTIONS, SETTINGS_ICON, type SectionId } from "./sections";
import { usePrefs } from "./prefs";
import { useUi } from "./store";
import { projectHue } from "./theme";
import { useAppTheme } from "./useAppTheme";
import { useEditor } from "../editor/store";

const VIEWS: Record<Exclude<SectionId, "cowriter">, () => React.JSX.Element | null> = {
  library: LibraryView,
  editor: EditorView,
  lorebook: LorebookView,
  trackers: TrackersView,
  engine: EngineView,
  assets: AssetsView,
  settings: SettingsView,
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
  const glow = usePrefs((p) => p.engineGlow);
  useAppTheme();

  // Each section starts at the top instead of keeping the previous section's scroll position.
  useEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [section]);

  // On large screens the co-writer is always docked, so the main area falls back to the editor.
  const MainView = section === "cowriter" ? EditorView : VIEWS[section];

  return (
    <div className="flex h-full flex-col md:flex-row">
      <header className="pt-safe flex items-center gap-2 border-b border-border bg-surface-raised px-4 md:hidden">
        <img src="/icon.svg" alt="" className="size-6" />
        <span className="flex-1 py-3 font-semibold">CardForge</span>
        <button
          type="button"
          aria-label="Settings"
          aria-current={section === "settings" ? "page" : undefined}
          onClick={() => setSection("settings")}
          className={`-mr-2 rounded-lg p-2 ${section === "settings" ? "text-accent" : "text-ink-muted hover:text-ink"}`}
        >
          <Icon path={SETTINGS_ICON} />
        </button>
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
            glow={glow && s.id === "engine"}
          />
        ))}
        <NavButton
          label="Settings"
          icon={SETTINGS_ICON}
          active={section === "settings"}
          onClick={() => setSection("settings")}
          className="mt-auto"
        />
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
        className="pb-safe grid grid-cols-7 border-t border-border bg-surface-raised md:hidden"
      >
        {SECTIONS.map((s) => (
          <NavButton
            key={s.id}
            label={s.label}
            icon={s.icon}
            active={section === s.id}
            onClick={() => setSection(s.id)}
            glow={glow && s.id === "engine"}
          />
        ))}
      </nav>
      <ProjectLine />
      <Toaster />
    </div>
  );
}

/** A thin line in the open card's project colour, so projects are told apart at a glance. */
function ProjectLine() {
  const on = usePrefs((p) => p.projectLine);
  const projectId = useEditor((s) => s.record?.projectId);
  if (!on || !projectId) return null;
  return (
    <div
      data-testid="project-line"
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
      style={{ background: `hsl(${projectHue(projectId)} 75% 60%)` }}
    />
  );
}

interface NavButtonProps {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  className?: string;
  /** The animated RGB light the Immersive Engine button wears. */
  glow?: boolean;
}

function NavButton({ label, icon, active, onClick, className = "", glow }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] transition-colors md:w-16 ${
        active ? "text-accent md:bg-accent/10" : "text-ink-muted hover:text-ink"
      } ${glow ? "rgb-glow" : ""} ${className}`}
    >
      <Icon path={icon} />
      {label}
    </button>
  );
}
