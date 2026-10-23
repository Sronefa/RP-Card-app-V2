/** Test helper: a fetch Response streaming server-sent events. */
export function sseResponse(events: unknown[], named = false): Response {
  const text = events
    .map((e) => {
      const data = typeof e === "string" ? e : JSON.stringify(e);
      const type = named && typeof e === "object" && e && "type" in e ? `event: ${(e as { type: string }).type}\n` : "";
      return `${type}data: ${data}\n\n`;
    })
    .join("");
  // Split mid-line to check that the reader buffers partial lines.
  const bytes = new TextEncoder().encode(text);
  const cut = Math.floor(bytes.length / 2);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.slice(0, cut));
      c.enqueue(bytes.slice(cut));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
