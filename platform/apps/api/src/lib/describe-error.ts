/**
 * Turns an unknown thrown value into a log line worth reading.
 *
 * The usual idiom, `err instanceof Error ? err.message : String(err)`, silently
 * degrades to the literal string `"[object Object]"` for anything thrown that
 * is not an `Error` — and the database layer throws exactly that. Prisma with
 * the Neon serverless adapter surfaces a connection failure as a DOM-style
 * `ErrorEvent`: `instanceof Error` is false, but `.message` is
 * `"connect ECONNREFUSED …"`, the one detail an operator needs. Verified by
 * driving the built bundle against a closed port — the log read
 * `{"detail":"[object Object]"}` while the cause sat on a property the idiom
 * had already stepped past.
 *
 * So the message is taken from any object that has a string one, whatever its
 * prototype, before falling back.
 */
export function describeError(err: unknown): string {
  if (typeof err === 'string') return err;

  if (typeof err === 'object' && err !== null) {
    const { message } = err as { message?: unknown };
    if (typeof message === 'string' && message.length > 0) {
      // `ErrorEvent`, `AggregateError`, a plain `{ message }` — all readable.
      const name = (err as { name?: unknown }).name;
      const label = typeof name === 'string' && name.length > 0 && name !== 'Error' ? `${name}: ` : '';
      return `${label}${message}`;
    }

    // No message anywhere: the shape itself is the only clue left.
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') return json;
    } catch {
      // Circular or non-serializable — fall through.
    }
    const ctor = (err as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof ctor === 'string' && ctor.length > 0) return `<unserializable ${ctor}>`;
  }

  return String(err);
}
