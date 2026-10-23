import type { CardDataV3 } from "../../card";
import type { CardKind } from "../../db/db";

export type GroupId = "basics" | "description" | "personality" | "scenario" | "greetings" | "examples" | "prompts" | "notes";

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: "basics", label: "Basics" },
  { id: "description", label: "Description" },
  { id: "personality", label: "Personality" },
  { id: "scenario", label: "Scenario" },
  { id: "greetings", label: "Greetings" },
  { id: "examples", label: "Examples" },
  { id: "prompts", label: "Prompts" },
  { id: "notes", label: "Notes" },
];

type TextField = {
  [K in keyof CardDataV3]-?: CardDataV3[K] extends string ? K : never;
}[keyof CardDataV3];

export interface FieldInfo {
  field: TextField;
  label: string;
  help: string | ((kind: CardKind) => string);
  placeholder?: string;
}

/** Long-text fields per group. Help text follows the co-writer spec's writing principles. */
export const TEXT_FIELDS: Partial<Record<GroupId, FieldInfo[]>> = {
  description: [
    {
      field: "description",
      label: "Description",
      help: (kind) =>
        kind === "world"
          ? "The world's premise, rules, tone and the narrator's voice. Sent every turn, so keep the most important facts first."
          : "Who {{char}} is. Sent every turn: put what matters most at the top and prefer concrete details over adjectives.",
    },
  ],
  personality: [
    {
      field: "personality",
      label: "Personality",
      help: "A short personality summary. Sent every turn. State behaviour positively rather than with \"never\".",
    },
  ],
  scenario: [
    {
      field: "scenario",
      label: "Scenario",
      help: (kind) =>
        kind === "world" ? "The starting situation in the world." : "The situation the roleplay starts in. Sent every turn.",
    },
  ],
  examples: [
    {
      field: "mes_example",
      label: "Example dialogues",
      help: "Shows voice, speech tics and formatting, not plot. Start each example with <START>.",
      placeholder: "<START>\n{{user}}: ...\n{{char}}: ...",
    },
  ],
  prompts: [
    {
      field: "system_prompt",
      label: "System prompt",
      help: "Overrides the user's main prompt in SillyTavern. Leave empty unless the card needs it. {{original}} inserts the user's own prompt.",
    },
    {
      field: "post_history_instructions",
      label: "Post-history instructions",
      help: "Sent after the chat history (a jailbreak/UJB slot). Use sparingly. {{original}} inserts the user's own.",
    },
  ],
  notes: [
    {
      field: "creator_notes",
      label: "Creator notes",
      help: "Shown to people who download the card. Not sent to the model.",
    },
  ],
};

/** Fields SillyTavern sends with every message. */
export const PERMANENT_FIELDS: TextField[] = ["description", "personality", "scenario"];
