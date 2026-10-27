import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiSettings, DEFAULT_IMAGE_STYLES, type AiSettings } from "../../ai/settings";
import { newCard, type CardDataV3 } from "../../card";
import { createCard, createProject, resetDbForTests } from "../../db/db";
import { useEditor } from "../../editor/store";
import { comfyGenerate, detectMap, fillWorkflow, importWorkflow, injectLora, STARTER_WORKFLOWS } from "../../images/comfy";
import { fileCandidate, readAssetTags } from "../../images/filing";
import { generateImages, readImageModels, type ImageProviderConfig } from "../../images/providers";
import { useImageQueue } from "../../images/queue";
import { loadStudio, proposeShots, saveStudio, newStudio, type Candidate } from "../../images/shots";
import { newSheet, readSheets, writeSheet } from "../../images/visual";
import { AssetsView } from "../assets/AssetsView";
import { SettingsView } from "../settings/SettingsView";

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const b64 = btoa(String.fromCharCode(...PNG));

const nano: ImageProviderConfig = {
  id: "img",
  kind: "nanogpt",
  name: "NanoGPT",
  baseUrl: "https://nano-gpt.com/api/v1",
  apiKey: "k",
  models: [{ id: "flux", name: "Flux", price: 0.05, imageToImage: true, params: ["seed", "strength", "negative_prompt"] }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
let bodies: Record<string, unknown>[] = [];

function settings(patch: Partial<AiSettings> = {}): AiSettings {
  return { providers: [], modeModels: {}, noToolModels: [], presets: [], imageStyles: DEFAULT_IMAGE_STYLES, imageProviders: [nano], ...patch };
}

function card(): CardDataV3 {
  const d = newCard("Sera").data;
  d.first_mes = "Hello.";
  return d;
}

beforeEach(async () => {
  await resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
  bodies = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.body && typeof init.body === "string") bodies.push(JSON.parse(init.body));
    if (url.endsWith("/images/generations")) return json({ data: [{ b64_json: b64 }, { b64_json: b64 }], cost: 0.1 });
    if (url.endsWith("/images/models")) return json({ data: [{ id: "flux", name: "Flux", pricing: { per_image: 0.05 } }] });
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  useAiSettings.setState({ loaded: true, settings: settings() });
  useImageQueue.setState({ jobs: [], paused: false, pauseReason: undefined, batchSpent: 0, cap: undefined, version: 0 });
  useEditor.setState({ record: undefined, past: [], future: [], saveState: "saved" });
  const project = await createProject("P");
  const record = await createCard(project.id, "character");
  await useEditor.getState().open(record.id);
  useEditor.getState().replaceData(card());
});
afterEach(() => vi.unstubAllGlobals());

describe("image providers", () => {
  it("reads model lists in their different shapes", () => {
    expect(
      readImageModels({
        data: [
          {
            id: "flux",
            name: "Flux",
            pricing: { per_image: 0.02 },
            capabilities: { image_to_image: true, nsfw: true },
            supported_parameters: ["seed", "strength"],
          },
        ],
      }),
    ).toEqual([{ id: "flux", name: "Flux", price: 0.02, imageToImage: true, nsfw: true, params: ["seed", "strength"] }]);
    expect(readImageModels({ models: { "hidream": { name: "HiDream", cost: "0.03" } } })).toEqual([{ id: "hidream", name: "HiDream", price: 0.03 }]);
  });

  it("sends NanoGPT the size, seed and reference, and reads the images and cost", async () => {
    const result = await generateImages(nano, {
      model: "flux",
      prompt: "a ranger",
      negative: "blurry",
      width: 832,
      height: 1216,
      n: 2,
      seed: 7,
      reference: PNG,
      strength: 0.6,
      task: "character",
    });
    expect(result.cost).toBe(0.1);
    expect(result.images).toHaveLength(2);
    expect(result.images[0].bytes).toEqual(PNG);
    expect(bodies[0]).toMatchObject({ model: "flux", size: "832x1216", aspect_ratio: "13:19", seed: 7, strength: 0.6, negative_prompt: "blurry" });
    expect(String(bodies[0].imageDataUrl)).toMatch(/^data:image\/png;base64,/);
  });
});

describe("ComfyUI", () => {
  it("maps the starter workflows and rejects editor-format files", () => {
    const [t2i, i2i, face] = STARTER_WORKFLOWS;
    expect(t2i.map).toMatchObject({
      positive: { node: "6", input: "text" },
      negative: { node: "7", input: "text" },
      seed: { node: "3", input: "seed" },
      width: { node: "5", input: "width" },
      checkpoint: { node: "4", input: "ckpt_name" },
    });
    expect(i2i.map.reference).toEqual({ node: "11", input: "image" });
    expect(face.map.positive).toEqual({ node: "6", input: "text" });
    expect(() => importWorkflow("x", JSON.stringify({ nodes: [], links: [] }))).toThrow(/Save \(API\)/);
    expect(importWorkflow("Mine", JSON.stringify(t2i.graph)).map).toEqual(detectMap(t2i.graph));
  });

  it("fills a workflow and wires in a LoRA when it has none", () => {
    const graph = fillWorkflow(
      STARTER_WORKFLOWS[0],
      { model: "anime.safetensors", prompt: "p", negative: "n", width: 512, height: 768, n: 2, task: "character", lora: { name: "sera.safetensors", weight: 0.7 } },
      42,
    );
    expect(graph["6"].inputs.text).toBe("p");
    expect(graph["3"].inputs.seed).toBe(42);
    expect(graph["5"].inputs).toMatchObject({ width: 512, height: 768, batch_size: 2 });
    expect(graph["4"].inputs.ckpt_name).toBe("anime.safetensors");
    expect(graph.cardforge_lora.inputs).toMatchObject({ lora_name: "sera.safetensors", model: ["4", 0], clip: ["4", 1] });
    expect(graph["3"].inputs.model).toEqual(["cardforge_lora", 0]);
    expect(graph["6"].inputs.clip).toEqual(["cardforge_lora", 1]);
    expect(injectLora(graph, {}, "x", 1)).toBe(graph);
  });

  it("queues a prompt and reads the image back from history", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/prompt")) {
        bodies.push(JSON.parse(String(init!.body)));
        return json({ prompt_id: "abc" });
      }
      if (url.endsWith("/history/abc"))
        return json({ abc: { outputs: { "9": { images: [{ filename: "a.png", subfolder: "", type: "output" }] } } } });
      if (url.includes("/view?")) return new Response(PNG, { headers: { "content-type": "image/png" } });
      return json({}, 404);
    });
    const comfy: ImageProviderConfig = { id: "c", kind: "comfyui", name: "Comfy", baseUrl: "http://127.0.0.1:8188", apiKey: "" };
    const result = await comfyGenerate(comfy, { model: "m.safetensors", prompt: "a ranger", negative: "", width: 832, height: 1216, n: 1, seed: 5, task: "character" });
    expect(result.images[0]).toMatchObject({ bytes: PNG, seed: 5 });
    expect((bodies[0].prompt as Record<string, { inputs: Record<string, unknown> }>)["6"].inputs.text).toBe("a ranger");
  });
});

describe("queue", () => {
  async function plan() {
    const id = useEditor.getState().record!.id;
    const shots = proposeShots(useEditor.getState().record!.card.data, "character", { emotions: ["joy", "anger"] }).filter((s) => s.kind === "emotion");
    await saveStudio({ ...newStudio(id), shots });
    return { id, shots };
  }

  it("makes candidates, adds up the cost, and pauses at the spending cap", async () => {
    const { id, shots } = await plan();
    useImageQueue.getState().enqueue(id, shots, { n: 2, cap: 0.15 });
    await waitFor(() => expect(useImageQueue.getState().pauseReason).toMatch(/spending cap of \$0.15/));
    const jobs = useImageQueue.getState().jobs;
    expect(jobs.map((j) => j.status)).toEqual(["done", "queued"]);
    expect(jobs[0].cost).toBe(0.1);
    const studio = await loadStudio(id);
    expect(studio.candidates?.[shots[0].id]).toHaveLength(2);
    // Resuming past the cap goes on with the batch.
    useImageQueue.getState().resume();
    await waitFor(() => expect(useImageQueue.getState().jobs.map((j) => j.status)).toEqual(["done", "done"]));
  });

  it("marks failures and retries them", async () => {
    const { id, shots } = await plan();
    fetchMock.mockImplementationOnce(async () => json({ error: { message: "model busy" } }, 503));
    useImageQueue.getState().enqueue(id, shots.slice(0, 1), { n: 1 });
    await waitFor(() => expect(useImageQueue.getState().jobs[0]).toMatchObject({ status: "failed", error: "503: model busy" }));
    useImageQueue.getState().retryFailed();
    await waitFor(() => expect(useImageQueue.getState().jobs[0].status).toBe("done"));
  });
});

describe("filing", () => {
  const candidate = (): Candidate => ({ id: "c1", bytes: PNG, mime: "image/png", model: "img/flux", at: 0 });

  it("files emotions as sprites named by label, replacing an older pick, and tags them", async () => {
    const shots = proposeShots(card(), "character", { emotions: ["joy"] });
    const joy = shots.find((s) => s.emotion === "joy")!;
    const first = await fileCandidate(card(), {}, joy, candidate());
    expect(first.asset).toMatchObject({ type: "emotion", name: "joy", ext: "png" });
    expect(readAssetTags(first.data)[first.asset.uri]).toEqual({ subject: "card", kind: "emotion", variant: "joy" });
    const again = await fileCandidate(first.data, first.files, joy, { ...candidate(), id: "c2" });
    expect(again.data.assets!.filter((a) => a.type === "emotion")).toHaveLength(1);
    expect(readAssetTags(again.data)[first.asset.uri]).toBeUndefined();
  });

  it("files the first background as the main one", async () => {
    const shot = { id: "b", group: "backgrounds" as const, kind: "background" as const, label: "The Ferry, night", time: "night", weather: "clear", framing: "landscape" as const };
    const filed = await fileCandidate(card(), {}, shot, candidate());
    expect(filed.asset).toMatchObject({ type: "background", name: "main" });
    expect(readAssetTags(filed.data)[filed.asset.uri]).toEqual({ kind: "background", variant: "night" });
  });
});

describe("pages", () => {
  it("picks a candidate into the card and makes it the character's reference", async () => {
    const { id } = { id: useEditor.getState().record!.id };
    useEditor.getState().replaceData(writeSheet(useEditor.getState().record!.card.data, "card", newSheet("character")));
    const shots = proposeShots(useEditor.getState().record!.card.data, "character", { emotions: [] }).filter((s) => s.kind === "portrait");
    await saveStudio({ ...newStudio(id), shots, candidates: { [shots[0].id]: [{ id: "c1", bytes: PNG, mime: "image/png", model: "img/flux", at: 0, seed: 9 }] } });
    render(<AssetsView />);
    fireEvent.click(screen.getByRole("tab", { name: "Image Studio" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Generate" }));
    expect(await screen.findByText(/0 shots still need images/)).toBeTruthy();
    const gallery = await screen.findByRole("region", { name: "Images for Sera: portrait" });
    fireEvent.click(within(gallery).getByRole("button", { name: "Pick image 1 for Sera: portrait" }));
    await waitFor(() => expect(useEditor.getState().record!.card.data.assets!.some((a) => a.name === "sera-portrait")).toBe(true));
    fireEvent.click(await within(gallery).findByRole("button", { name: "Use as reference" }));
    const sheet = readSheets(useEditor.getState().record!.card.data).card;
    expect(sheet.reference).toMatch(/sera-portrait/);
    expect(sheet.referenceSeed).toBe(9);
  });

  it("adds an image provider in Settings and loads its models", async () => {
    useAiSettings.setState({ loaded: true, settings: settings({ imageProviders: [] }) });
    render(<SettingsView />);
    const section = await screen.findByRole("region", { name: "Image providers" });
    fireEvent.click(within(section).getByRole("button", { name: "Add image provider" }));
    const card = await within(section).findByRole("group", { name: "Image provider NanoGPT" });
    fireEvent.change(within(card).getByLabelText("API key"), { target: { value: "key" } });
    fireEvent.click(within(card).getByRole("button", { name: "Load models" }));
    await waitFor(() => expect(useAiSettings.getState().settings.imageProviders?.[0].models).toEqual([{ id: "flux", name: "Flux", price: 0.05 }]));
    expect(await within(section).findByRole("combobox", { name: "Character art" })).toBeTruthy();
  });
});
