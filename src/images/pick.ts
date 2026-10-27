/** Picking a generated image: it becomes a filed card asset and the shot's chosen candidate. */
import type { CardAsset } from "../card";
import { useEditor } from "../editor/store";
import { withFreshArt } from "./engineArt";
import { fileCandidate } from "./filing";
import type { Candidate, Shot, StudioRecord } from "./shots";

/** Files the candidate into the open card, if it is still the card `cardId`. */
export async function fileInCard(cardId: string, shot: Shot, candidate: Candidate): Promise<CardAsset | undefined> {
  const editor = useEditor.getState();
  const current = editor.record;
  if (!current || current.id !== cardId) return undefined;
  const filed = await fileCandidate(current.card.data, current.files, shot, candidate);
  editor.addFiles(filed.files);
  editor.replaceData(withFreshArt(filed.data));
  return filed.asset;
}

/** Marks one candidate as the shot's pick; the shot's others are unpicked. */
export const markPicked = (s: StudioRecord, shotId: string, candidateId: string, uri: string): StudioRecord => ({
  ...s,
  candidates: {
    ...s.candidates,
    [shotId]: (s.candidates?.[shotId] ?? []).map((c) => (c.id === candidateId ? { ...c, asset: uri } : { ...c, asset: undefined })),
  },
});

export const filedNote = (asset: CardAsset) =>
  `Filed as ${asset.type === "emotion" ? `the ${asset.name} sprite` : asset.type === "background" ? "a background" : "an image"}`;
