/** Opens the co-writer chat from elsewhere in the app, with a request sent or ready to edit. */
import { useUi } from "../app/store";
import { useEditor } from "../editor/store";
import { useCowriter } from "./store";

export async function askCowriter({ send, draft }: { send?: string; draft?: string }) {
  const ui = useUi.getState();
  ui.setCowriterTab("chat");
  ui.setSection("cowriter");
  const record = useEditor.getState().record;
  if (!record) return;
  if (draft !== undefined) useCowriter.getState().setDraft(draft);
  if (send) {
    await useCowriter.getState().load(record.id);
    await useCowriter.getState().send(send);
  }
}
