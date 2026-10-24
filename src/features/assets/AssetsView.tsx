import { useState } from "react";
import { assetPath, embeddedPath, embeddedUri, type CardAsset } from "../../card";
import { DEFAULT_ICON } from "../../card/assets";
import { toast } from "../../components/toast";
import { Button, Dialog, TextInput } from "../../components/ui";
import type { CardRecord } from "../../db/db";
import { useEditor } from "../../editor/store";
import { pickFiles, readFileBytes, safeFileName, saveFile } from "../../lib/files";
import { useObjectUrl } from "../../lib/useObjectUrl";
import { ImagePromptDialog } from "../images/ImagePromptDialog";
import { CardBar } from "../editor/CardBar";
import { NoCard } from "../editor/NoCard";

const TYPES: { type: string; label: string; help: string; accept: string }[] = [
  { type: "icon", label: "Icons", help: "Alternate avatars. The one named main is the card's avatar.", accept: "image/*" },
  { type: "background", label: "Backgrounds", help: "Chat backgrounds for this card.", accept: "image/*" },
  {
    type: "emotion",
    label: "Expressions",
    help: "Sprites named after the emotion they show, like joy or anger. Name the files that way before adding them.",
    accept: "image/*",
  },
  { type: "user_icon", label: "User avatars", help: "Avatars suggested for the user.", accept: "image/*" },
  { type: "other", label: "Other", help: "Any other file, such as music or sounds.", accept: "image/*,audio/*" },
];

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  opus: "audio/ogg",
};

/** The file bytes behind an asset, if they are stored in the card. */
function assetBytes(record: CardRecord, asset: CardAsset): Uint8Array | undefined {
  if (asset.uri === "ccdefault:") return record.image;
  const path = embeddedPath(asset.uri);
  return path ? record.files[path] : undefined;
}

const typeGroup = (type: string) => (TYPES.some((t) => t.type === type) ? type : "other");
const isImage = (ext: string) => MIME[ext.toLowerCase()]?.startsWith("image/") ?? false;

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AssetsView() {
  const record = useEditor((s) => s.record);
  const { setField, addFiles } = useEditor();
  const [editing, setEditing] = useState<number>();
  const [prompting, setPrompting] = useState(false);

  if (!record) return <NoCard />;

  const assets = record.card.data.assets ?? [{ ...DEFAULT_ICON }];
  const setAssets = (next: CardAsset[], coalesceKey?: string) => setField("assets", next, coalesceKey ?? null);
  const totalBytes = assets.reduce((n, a) => n + (assetBytes(record, a)?.length ?? 0), 0);

  async function add(type: string, accept: string) {
    const picked = await pickFiles(accept, true);
    if (picked.length === 0) return;
    const taken = new Set(Object.keys(record!.files));
    const files: Record<string, Uint8Array> = {};
    const added: CardAsset[] = [];
    const hasMain = assets.some((a) => a.type === type && a.name === "main");
    for (const file of picked) {
      const dot = file.name.lastIndexOf(".");
      const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "bin";
      const base = dot > 0 ? file.name.slice(0, dot) : file.name;
      // The first icon or background added becomes the main one if there is none yet.
      const name = (type === "icon" || type === "background") && !hasMain && added.length === 0 ? "main" : base;
      const asset = { type, name, ext, uri: "" };
      const path = assetPath(asset, taken);
      files[path] = await readFileBytes(file);
      added.push({ ...asset, uri: embeddedUri(path) });
    }
    addFiles(files);
    setAssets([...(useEditor.getState().record?.card.data.assets ?? assets), ...added]);
    toast(`Added ${added.length} ${added.length === 1 ? "file" : "files"}`);
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-surface/95 pb-3 backdrop-blur">
        <CardBar detail={`${assets.length} assets · ${formatSize(totalBytes)}`} />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
        <p className="text-sm text-ink-muted">
          Files that travel inside the card. PNG and CHARX exports include them; a JSON export can't. Large files make
          PNG cards much bigger, so prefer CHARX for many sprites.
        </p>
        <Button className="self-start" onClick={() => setPrompting(true)}>
          ✦ Write an image prompt
        </Button>
        {prompting && <ImagePromptDialog onClose={() => setPrompting(false)} />}
        {TYPES.map((t) => {
          const items = assets.map((a, i) => ({ a, i })).filter(({ a }) => typeGroup(a.type) === t.type);
          return (
            <section key={t.type} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-medium">{t.label}</h2>
                <Button onClick={() => void add(t.type, t.accept)} aria-label={`Add ${t.label.toLowerCase()}`}>
                  Add
                </Button>
              </div>
              <p className="text-xs text-ink-muted">{t.help}</p>
              {items.length > 0 && (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {items.map(({ a, i }) => (
                    <li key={i}>
                      <AssetTile record={record} asset={a} onClick={() => setEditing(i)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <Dialog open={editing !== undefined && !!assets[editing]} title="Asset" onClose={() => setEditing(undefined)}>
        {editing !== undefined && assets[editing] && (
          <AssetForm
            record={record}
            asset={assets[editing]}
            onChange={(asset, coalesceKey) => setAssets(assets.map((a, j) => (j === editing ? asset : a)), coalesceKey)}
            onMakeMain={() => {
              const target = assets[editing];
              // The previous main asset of this type keeps a numbered name.
              setAssets(
                assets.map((a, j) =>
                  j === editing ? { ...a, name: "main" } : a.type === target.type && a.name === "main" ? { ...a, name: `${a.type}-${j + 1}` } : a,
                ),
              );
            }}
            onRemove={() => {
              setAssets(assets.filter((_, j) => j !== editing));
              setEditing(undefined);
              toast("Asset removed. Undo with ↶ if that was a mistake.");
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function AssetPreview({ record, asset, className }: { record: CardRecord; asset: CardAsset; className: string }) {
  const bytes = assetBytes(record, asset);
  const mime = asset.uri === "ccdefault:" ? "image/png" : (MIME[asset.ext.toLowerCase()] ?? "application/octet-stream");
  const objectUrl = useObjectUrl(bytes, mime);
  const url = objectUrl ?? (/^(https?:|data:)/.test(asset.uri) ? asset.uri : undefined);
  if (url && (isImage(asset.ext) || asset.uri === "ccdefault:"))
    return <img src={url} alt="" className={`${className} object-cover`} />;
  return (
    <div className={`${className} flex items-center justify-center bg-surface-sunken text-xs text-ink-muted uppercase`}>
      {bytes || url ? asset.ext : asset.uri === "ccdefault:" ? "No image" : "Missing"}
    </div>
  );
}

function AssetTile({ record, asset, onClick }: { record: CardRecord; asset: CardAsset; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-raised text-left hover:border-ink-muted"
    >
      <AssetPreview record={record} asset={asset} className="aspect-square w-full" />
      <span className="truncate px-2 py-1 text-xs">
        {asset.name === "main" ? <strong className="text-accent">main</strong> : asset.name}
        {asset.uri === "ccdefault:" && <span className="text-ink-muted"> · card image</span>}
      </span>
    </button>
  );
}

function AssetForm({
  record,
  asset,
  onChange,
  onMakeMain,
  onRemove,
}: {
  record: CardRecord;
  asset: CardAsset;
  onChange: (asset: CardAsset, coalesceKey?: string) => void;
  onMakeMain: () => void;
  onRemove: () => void;
}) {
  const bytes = assetBytes(record, asset);
  const mime = MIME[asset.ext.toLowerCase()];
  const audioUrl = useObjectUrl(mime?.startsWith("audio/") ? bytes : undefined, mime);
  const known = TYPES.some((t) => t.type === asset.type);

  return (
    <div className="flex flex-col gap-3">
      <AssetPreview record={record} asset={asset} className="max-h-64 w-full rounded-lg object-contain" />
      {audioUrl && <audio controls src={audioUrl} className="w-full" />}
      <p className="text-xs text-ink-muted">
        {asset.uri === "ccdefault:"
          ? "This is the card's own image. Change it in the editor's Basics."
          : bytes
            ? `${asset.ext.toUpperCase()} · ${formatSize(bytes.length)}`
            : embeddedPath(asset.uri)
              ? "The file for this asset is missing."
              : asset.uri}
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Name
        <TextInput value={asset.name} onChange={(e) => onChange({ ...asset, name: e.target.value }, "asset.name")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Type
        <select
          className="min-h-10 rounded-lg border border-border bg-surface-sunken px-2"
          value={asset.type}
          onChange={(e) => onChange({ ...asset, type: e.target.value })}
        >
          {!known && <option value={asset.type}>{asset.type}</option>}
          {TYPES.filter((t) => t.type !== "other").map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
          <option value="other">Other</option>
        </select>
      </label>
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="danger" onClick={onRemove}>
            Remove
          </Button>
          {bytes && (
            <Button
              onClick={() =>
                void saveFile(`${safeFileName(asset.name, "asset")}.${asset.ext}`, bytes, {
                  filterName: asset.ext.toUpperCase(),
                  extensions: [asset.ext],
                  mime: mime ?? "application/octet-stream",
                })
              }
            >
              Save file
            </Button>
          )}
        </div>
        <Button variant="primary" disabled={asset.name === "main"} onClick={onMakeMain}>
          Make main
        </Button>
      </div>
    </div>
  );
}
