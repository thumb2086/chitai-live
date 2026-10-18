type StreamEntry = {
  userId: string;
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
};

// Route handlers are evaluated per-request and may land in different module
// instances, so a module-level Map would give the writer (POST /segments) and
// the reader (GET /stream) separate registries and broadcasts would vanish.
// Parking the registry on globalThis keeps one hub per process.
const registry = globalThis as typeof globalThis & {
  __captionSseClients?: Map<string, Set<StreamEntry>>;
};
const clients: Map<string, Set<StreamEntry>> = (registry.__captionSseClients ??= new Map());

export function addClient(userId: string, controller: ReadableStreamDefaultController) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  const encoder = new TextEncoder();
  const entry: StreamEntry = { userId, controller, encoder };
  clients.get(userId)!.add(entry);
  controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));
  return () => {
    const set = clients.get(userId);
    if (set) {
      set.delete(entry);
      if (set.size === 0) clients.delete(userId);
    }
  };
}

/**
 * The response body for GET /api/v1/captions/stream.
 *
 * Both teardown paths are wired up, and that is the point:
 *
 *   - `cancel()` is what a dropped connection actually looks like to a
 *     ReadableStream. Registering cleanup only on `signal.abort` left the
 *     controller in the global registry forever -- one leak per OBS reconnect,
 *     with broadcast() still enqueueing into controllers nobody reads.
 *   - `signal.abort` still covers the platforms that report disconnects that
 *     way, and both call `release()`.
 *
 * `release()` is idempotent so the two paths cannot double-decrement.
 */
export function createSseStream(userId: string, signal: AbortSignal): ReadableStream {
  let release: (() => void) | null = null;
  return new ReadableStream({
    start(controller) {
      const cleanup = addClient(userId, controller);
      let done = false;
      release = () => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", release!);
        cleanup();
      };
      if (signal.aborted) release();
      else signal.addEventListener("abort", release);
    },
    cancel() {
      release?.();
    },
  });
}

export function broadcast(userId: string, event: string, data: unknown) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const entry of set) {
    try {
      entry.controller.enqueue(entry.encoder.encode(payload));
    } catch {
      set.delete(entry);
    }
  }
}

/** Number of live listeners; used by the dev check script. */
export function clientCount(userId: string) {
  return clients.get(userId)?.size ?? 0;
}
