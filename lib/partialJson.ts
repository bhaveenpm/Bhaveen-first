/**
 * The model returns the whole listing as ONE forced tool call, which arrives as
 * `input_json_delta` fragments of a single JSON document. The spec (§5) wants SSE
 * `delta` events carrying `{ path, chunk }` so each UI field fills independently.
 *
 * So: tolerantly parse the JSON prefix on every fragment, then diff the resulting
 * snapshot against the last one and emit per-path deltas. A tolerant parse of a
 * ~3KB payload is microseconds — far cheaper than the network hop that delivered it.
 */

type Parsed = { value: unknown; complete: boolean };

/**
 * Parse a possibly-truncated JSON document, returning whatever is unambiguously
 * present. A trailing incomplete string yields its characters so far; a trailing
 * incomplete key (no colon yet) is dropped, because its value is unknowable.
 */
export function parsePartialJson(src: string): unknown {
  let i = 0;

  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };

  function parseString(): Parsed {
    // assumes src[i] === '"'
    i++;
    let out = "";
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") {
        if (i + 1 >= src.length) {
          // dangling escape — the escaped char has not arrived yet
          i++;
          return { value: out, complete: false };
        }
        const e = src[i + 1];
        const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
        if (e === "u") {
          if (i + 5 >= src.length) {
            i = src.length;
            return { value: out, complete: false };
          }
          out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
          i += 6;
        } else {
          out += map[e] ?? e;
          i += 2;
        }
        continue;
      }
      if (c === '"') {
        i++;
        return { value: out, complete: true };
      }
      out += c;
      i++;
    }
    return { value: out, complete: false };
  }

  function parseValue(): Parsed {
    ws();
    if (i >= src.length) return { value: undefined, complete: false };
    const c = src[i];
    if (c === '"') return parseString();
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    // literal or number: read the token, then decide if it is whole
    const start = i;
    while (i < src.length && /[^\s,\]}]/.test(src[i])) i++;
    const tok = src.slice(start, i);
    const atEof = i >= src.length;
    if (tok === "true") return { value: true, complete: true };
    if (tok === "false") return { value: false, complete: true };
    if (tok === "null") return { value: null, complete: true };
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(tok)) {
      // A number touching EOF may still be growing ("35" could become "350"), so
      // withhold it entirely rather than emit a value that is about to change.
      return atEof ? { value: undefined, complete: false } : { value: Number(tok), complete: true };
    }
    return { value: undefined, complete: false };
  }

  function parseObject(): Parsed {
    i++; // {
    const obj: Record<string, unknown> = {};
    for (;;) {
      ws();
      if (i >= src.length) return { value: obj, complete: false };
      if (src[i] === "}") {
        i++;
        return { value: obj, complete: true };
      }
      if (src[i] === ",") {
        i++;
        continue;
      }
      if (src[i] !== '"') return { value: obj, complete: false };
      const key = parseString();
      if (!key.complete) return { value: obj, complete: false }; // key still arriving
      ws();
      if (i >= src.length || src[i] !== ":") return { value: obj, complete: false };
      i++; // :
      const val = parseValue();
      if (val.value !== undefined) obj[key.value as string] = val.value;
      if (!val.complete) return { value: obj, complete: false };
    }
  }

  function parseArray(): Parsed {
    i++; // [
    const arr: unknown[] = [];
    for (;;) {
      ws();
      if (i >= src.length) return { value: arr, complete: false };
      if (src[i] === "]") {
        i++;
        return { value: arr, complete: true };
      }
      if (src[i] === ",") {
        i++;
        continue;
      }
      const val = parseValue();
      if (val.value !== undefined) arr.push(val.value);
      if (!val.complete) return { value: arr, complete: false };
    }
  }

  ws();
  if (i >= src.length) return undefined;
  return parseValue().value;
}

export type PathDelta = { path: string; chunk: string; replace?: boolean };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Diff two snapshots into per-path deltas. String growth becomes an append; anything
 * else (a rewritten prefix, a number, a boolean) becomes a replace.
 */
export function diffSnapshots(prev: unknown, next: unknown, base = ""): PathDelta[] {
  const out: PathDelta[] = [];

  if (typeof next === "string") {
    const before = typeof prev === "string" ? prev : "";
    if (next === before) return out;
    if (next.startsWith(before)) {
      out.push({ path: base, chunk: next.slice(before.length) });
    } else {
      out.push({ path: base, chunk: next, replace: true });
    }
    return out;
  }

  if (Array.isArray(next)) {
    const before = Array.isArray(prev) ? prev : [];
    next.forEach((item, idx) => {
      out.push(...diffSnapshots(before[idx], item, base ? `${base}.${idx}` : String(idx)));
    });
    return out;
  }

  if (isPlainObject(next)) {
    const before = isPlainObject(prev) ? prev : {};
    for (const [k, v] of Object.entries(next)) {
      out.push(...diffSnapshots(before[k], v, base ? `${base}.${k}` : k));
    }
    return out;
  }

  if (next !== undefined && next !== prev) {
    out.push({ path: base, chunk: JSON.stringify(next), replace: true });
  }
  return out;
}

/**
 * Stateful accumulator: feed it `input_json_delta` fragments, get back the deltas to
 * put on the wire.
 */
export class PartialJsonStream {
  private buf = "";
  private snapshot: unknown = undefined;

  push(fragment: string): PathDelta[] {
    this.buf += fragment;
    const next = parsePartialJson(this.buf);
    if (next === undefined) return [];
    const deltas = diffSnapshots(this.snapshot, next);
    this.snapshot = next;
    return deltas;
  }

  get raw(): string {
    return this.buf;
  }
}
