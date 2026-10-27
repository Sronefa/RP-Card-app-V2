import { useCallback, useEffect, useState } from "react";
import { usesEngine } from "../../engine/sheet";
import { useUi } from "../../app/store";
import { toast } from "../../components/toast";
import { Button, Dialog, TextInput } from "../../components/ui";
import {
  createCard,
  deleteCard,
  deleteProject,
  getProject,
  listCards,
  listPersonas,
  saveCard,
  saveProject,
  type CardKind,
  type CardRecord,
  type PersonaRecord,
  type ProjectRecord,
} from "../../db/db";
import { embeddedPath } from "../../card";
import { useEditor } from "../../editor/store";
import { CARD_FILE_ACCEPT, exportRecord, importCard, kindOf, type ExportFormat } from "../../lib/cardFiles";
import { pickFiles, readFileBytes } from "../../lib/files";
import { REMIXES, remixRequest, type RemixKind } from "../../ai/prompts";
import { askCowriter } from "../../cowriter/ask";
import { useInterview } from "../../cowriter/interview";
import { ProjectStyleDialog } from "../cowriter/ProjectStyleDialog";
import { CardTile } from "./CardTile";
import { RemixDialog } from "./RemixDialog";
import { PersonaInterview } from "./PersonaInterview";
import { SurpriseDialog } from "./SurpriseDialog";
import { GuidePanel } from "./GuidePanel";
import { markStep } from "../../app/guide";

/** Images besides the avatar that only a CHARX file carries into SillyTavern. */
const hasPackedImages = (record: CardRecord) =>
  (record.card.data.assets ?? []).some((a) => embeddedPath(a.uri) && !(a.type === "icon" && a.name === "main"));

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { setProjectId, setSection, setEditorGroup } = useUi();
  const openCard = useEditor((s) => s.open);
  const closeEditor = useEditor((s) => s.close);
  const openCardId = useEditor((s) => s.record?.id);
  const [project, setProject] = useState<ProjectRecord>();
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [personas, setPersonas] = useState<PersonaRecord[]>([]);
  const [actionsFor, setActionsFor] = useState<CardRecord>();
  const [confirmDelete, setConfirmDelete] = useState<"project" | CardRecord>();
  const [addingPersona, setAddingPersona] = useState(false);
  const [buildingPersona, setBuildingPersona] = useState(false);
  const [styling, setStyling] = useState(false);
  const [remixing, setRemixing] = useState<CardRecord>();
  const [surprise, setSurprise] = useState<CardKind>();

  const reload = useCallback(async () => {
    // Save the open card first, so the list shows its latest name and image.
    await useEditor.getState().flush();
    const p = await getProject(projectId);
    if (!p) return setProjectId(undefined);
    setProject(p);
    setCards(await listCards(projectId));
    setPersonas(await listPersonas());
  }, [projectId, setProjectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!project) return null;

  const worlds = cards.filter((c) => c.kind === "world");
  const characters = cards.filter((c) => c.kind === "character");
  const linked = personas.filter((p) => project.personaIds.includes(p.id));

  async function open(record: CardRecord) {
    try {
      // A different card starts on Basics; reopening the same card keeps the current group.
      if (useEditor.getState().record?.id !== record.id) setEditorGroup("basics");
      await openCard(record.id);
      setSection("editor");
    } catch (e) {
      toast(`Couldn't open the card: ${(e as Error).message}`, "error");
      await reload();
    }
  }

  async function create(kind: CardKind) {
    await open(await createCard(projectId, kind));
  }

  /** A new card with an interview started from the drawn idea. */
  async function startSurprise(kind: CardKind, idea: string) {
    setSurprise(undefined);
    const record = await createCard(projectId, kind);
    await open(record);
    const ui = useUi.getState();
    ui.setCowriterTab("interview");
    ui.setSection("cowriter");
    await useInterview.getState().load(record.id);
    await useInterview.getState().start(idea);
  }

  /** Copies the card and has the co-writer rewrite the copy. */
  async function remix(record: CardRecord, kind: RemixKind, details: string) {
    setRemixing(undefined);
    if (record.id === openCardId) await useEditor.getState().flush();
    const source = record.id === openCardId ? useEditor.getState().record! : record;
    const card = structuredClone(source.card);
    const name = card.data.name;
    card.data.name = `${name} (${REMIXES[kind].label.toLowerCase()})`;
    const copy = await createCard(projectId, source.kind, {
      card,
      files: structuredClone(source.files),
      image: source.image && source.image.slice(),
    });
    await open(copy);
    await askCowriter({ send: remixRequest(name, kind, details) });
  }

  async function importFiles() {
    for (const file of await pickFiles(CARD_FILE_ACCEPT, true)) {
      try {
        const result = importCard(await readFileBytes(file));
        const { card, files, image } = result;
        await createCard(projectId, kindOf(result), { card, files, image });
        toast(
          result.warnings.length
            ? `Imported ${card.data.name || file.name}: ${result.warnings.join("; ")}`
            : `Imported ${card.data.name || file.name}`,
        );
      } catch (e) {
        toast(`Couldn't import ${file.name}: ${(e as Error).message}`, "error");
      }
    }
    await reload();
  }

  async function exportAs(record: CardRecord, format: ExportFormat) {
    setActionsFor(undefined);
    // Save pending edits first, so the export has them.
    if (record.id === openCardId) await useEditor.getState().flush();
    try {
      const warnings = await exportRecord(record.id === openCardId ? useEditor.getState().record! : record, format);
      if (warnings && format === "png" && hasPackedImages(record))
        warnings.push("SillyTavern ignores images inside PNG cards, so export as CHARX to keep them");
      if (warnings) toast(warnings.length ? `Exported with notes: ${warnings.join("; ")}` : "Exported");
      if (warnings && project?.guide?.on) await markStep(projectId, "export", true).then((p) => p && setProject(p));
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, "error");
    }
  }

  async function setKind(record: CardRecord, kind: CardKind) {
    setActionsFor(undefined);
    if (record.id === openCardId) {
      useEditor.getState().setKind(kind);
      await useEditor.getState().flush();
    } else {
      await saveCard({ ...record, kind });
    }
    await reload();
  }

  async function confirmDeletion() {
    const target = confirmDelete;
    setConfirmDelete(undefined);
    if (target === "project") {
      if (cards.some((c) => c.id === openCardId)) await closeEditor();
      await deleteProject(projectId);
      setProjectId(undefined);
    } else if (target) {
      if (target.id === openCardId) await closeEditor();
      await deleteCard(target.id);
      await reload();
    }
  }

  async function updatePersonas(personaIds: string[]) {
    // Re-read first: the co-writer settings may have been saved since this screen loaded.
    const fresh = (await getProject(projectId)) ?? project!;
    setProject(await saveProject({ ...fresh, personaIds }));
  }

  const section = (title: string, list: CardRecord[], actions: React.ReactNode, empty: string) => (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <div className="flex flex-wrap justify-end gap-2 whitespace-nowrap">{actions}</div>
      </div>
      {list.length === 0 && <p className="text-sm text-ink-muted">{empty}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((c) => (
          <CardTile key={c.id} record={c} onOpen={() => void open(c)} onMore={() => setActionsFor(c)} />
        ))}
      </div>
    </section>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => setProjectId(undefined)} aria-label="Back to projects">
          ←
        </Button>
        <TextInput
          key={project.id}
          defaultValue={project.name}
          aria-label="Project name"
          className="text-lg font-semibold"
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== project.name)
              void getProject(projectId).then((fresh) => saveProject({ ...(fresh ?? project), name }).then(setProject));
          }}
        />
      </div>

      <GuidePanel
        project={project}
        cards={cards}
        onChange={setProject}
        onOpen={open}
        onNewCharacter={() => createCard(projectId, "character")}
        onSurprise={() => setSurprise("character")}
        onExport={setActionsFor}
      />

      {section(
        "World",
        worlds,
        worlds.length === 0 && (
          <>
            <Button variant="ghost" onClick={() => setSurprise("world")}>
              ✦ Surprise me
            </Button>
            <Button onClick={() => void create("world")}>New world</Button>
          </>
        ),
        "The world card narrates the setting and carries the shared lorebook.",
      )}

      {section(
        "Characters",
        characters,
        <>
          <Button variant="ghost" onClick={() => setSurprise("character")}>
            ✦ Surprise me
          </Button>
          <Button onClick={() => void importFiles()}>Import</Button>
          <Button variant="primary" onClick={() => void create("character")}>
            New character
          </Button>
        </>,
        "No characters yet. Create one or import a PNG, CHARX or JSON card.",
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Personas</h2>
          <div className="flex flex-wrap justify-end gap-2">
            {cards.length > 0 && (
              <Button variant="ghost" onClick={() => setBuildingPersona(true)}>
                ✦ Build from a card
              </Button>
            )}
            <Button onClick={() => setAddingPersona(true)}>Add persona</Button>
          </div>
        </div>
        {linked.length === 0 && <p className="text-sm text-ink-muted">Pick personas from your library to use with this project.</p>}
        <div className="flex flex-wrap gap-2">
          {linked.map((p) => (
            <span key={p.id} className="flex items-center gap-1 rounded-full border border-border bg-surface-raised py-1 pr-1 pl-3 text-sm">
              {p.name}
              <button
                type="button"
                aria-label={`Remove ${p.name} from project`}
                className="flex size-7 items-center justify-center rounded-full text-ink-muted hover:text-ink"
                onClick={() => void updatePersonas(project.personaIds.filter((id) => id !== p.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Co-writer</h2>
        <p className="text-sm text-ink-muted">Content mode, tone, genre and how proactive the co-writer is in this project.</p>
        <Button className="self-start" onClick={() => setStyling(true)}>
          Co-writer settings
        </Button>
      </section>

      <div>
        <Button variant="danger" onClick={() => setConfirmDelete("project")}>
          Delete project
        </Button>
      </div>
      <ProjectStyleDialog projectId={projectId} open={styling} onClose={() => setStyling(false)} />
      {remixing && (
        <RemixDialog
          name={remixing.card.data.name || "the card"}
          onClose={() => setRemixing(undefined)}
          onRemix={(kind, details) => void remix(remixing, kind, details)}
        />
      )}
      {surprise && (
        <SurpriseDialog
          kind={surprise}
          onClose={() => setSurprise(undefined)}
          onStart={(idea) => void startSurprise(surprise, idea)}
        />
      )}

      <Dialog open={!!actionsFor} title={actionsFor?.card.data.name || "Card"} onClose={() => setActionsFor(undefined)}>
        {actionsFor && (
          <div className="flex flex-col gap-2">
            <Button variant="primary" onClick={() => void open(actionsFor).then(() => setActionsFor(undefined))}>
              Open in editor
            </Button>
            {hasPackedImages(actionsFor) ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Button onClick={() => void exportAs(actionsFor, "charx")}>Export CHARX</Button>
                  <Button onClick={() => void exportAs(actionsFor, "png")}>PNG</Button>
                  <Button onClick={() => void exportAs(actionsFor, "json")}>JSON</Button>
                </div>
                <p className="text-xs text-ink-muted">
                  This card carries images. SillyTavern only unpacks them from CHARX; a PNG card loses them. After
                  importing, keep the card's name in SillyTavern, or the image paths break.
                </p>
              </>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Button onClick={() => void exportAs(actionsFor, "png")}>Export PNG</Button>
                <Button onClick={() => void exportAs(actionsFor, "charx")}>CHARX</Button>
                <Button onClick={() => void exportAs(actionsFor, "json")}>JSON</Button>
              </div>
            )}
            {usesEngine(actionsFor.card.data) && (
              <p className="text-xs text-ink-muted">
                This card runs the Immersive Engine: in SillyTavern it needs the Tavern Helper extension
                (JS-Slash-Runner), and the player allows the card's script when asked.
              </p>
            )}
            <Button
              onClick={() => {
                setRemixing(actionsFor);
                setActionsFor(undefined);
              }}
            >
              ✦ Remix…
            </Button>
            <Button onClick={() => void setKind(actionsFor, actionsFor.kind === "world" ? "character" : "world")}>
              Make it a {actionsFor.kind === "world" ? "character" : "world"} card
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(actionsFor);
                setActionsFor(undefined);
              }}
            >
              Delete card
            </Button>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!confirmDelete}
        title={confirmDelete === "project" ? `Delete ${project.name}?` : `Delete ${(confirmDelete as CardRecord | undefined)?.card.data.name}?`}
        onClose={() => setConfirmDelete(undefined)}
      >
        <p className="mb-4 text-ink-muted">
          {confirmDelete === "project"
            ? "This deletes the project and all of its cards and their history. Personas stay in your library."
            : "This deletes the card and its version history."}
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(undefined)}>Cancel</Button>
          <Button variant="danger" onClick={() => void confirmDeletion()}>
            Delete
          </Button>
        </div>
      </Dialog>

      {buildingPersona && (
        <PersonaInterview
          sources={[...worlds, ...characters]}
          onClose={() => setBuildingPersona(false)}
          onCreated={(p) => {
            setBuildingPersona(false);
            setPersonas([...personas, p]);
            void updatePersonas([...project.personaIds, p.id]);
            toast(`${p.name} is in your persona library and linked to this project.`);
          }}
        />
      )}
      <Dialog open={addingPersona} title="Add a persona" onClose={() => setAddingPersona(false)}>
        {personas.length === 0 ? (
          <p className="text-ink-muted">Your persona library is empty. Create personas in the Personas tab.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {personas.map((p) => {
              const on = project.personaIds.includes(p.id);
              return (
                <li key={p.id}>
                  <Button
                    className="w-full justify-between"
                    onClick={() =>
                      void updatePersonas(on ? project.personaIds.filter((id) => id !== p.id) : [...project.personaIds, p.id])
                    }
                  >
                    {p.name}
                    <span className="text-ink-muted">{on ? "Added ✓" : "Add"}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
