// A small, dependency-free reader for the OpenAPI 3.1 document the API serves at /openapi.json.
// The public reference shows only what an API key can call (the flat routes), so readers never
// see session-only or admin operations.

export type Json = Record<string, unknown>;
export type Schema = Json;

export interface Param {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  description?: string;
  schema: Schema;
}

export interface Operation {
  id: string;
  slug: string;
  tag: string;
  tagSlug: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  summary: string;
  description: string;
  permission: string | null;
  params: Param[];
  body: { required: boolean; contentType: string; schema: Schema } | null;
  responses: Array<{
    status: string;
    description: string;
    schema: Schema | null;
    contentType: string | null;
  }>;
}

export interface Tag {
  name: string;
  slug: string;
  description: string;
  operations: Operation[];
}

export interface Spec {
  raw: Json;
  baseUrl: string;
  tags: Tag[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function fetchSpec(): Promise<Spec> {
  const res = await fetch('/openapi.json', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Could not load the API description (HTTP ${res.status})`);
  return parseSpec((await res.json()) as Json);
}

export function resolveRef(raw: Json, ref: string): Schema {
  let cur: unknown = raw;
  for (const part of ref.replace(/^#\//, '').split('/')) {
    cur = isObj(cur) ? cur[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
  }
  return isObj(cur) ? cur : {};
}

/** Follows `$ref` chains. `seen` stops cycles. */
export function deref(raw: Json, schema: unknown, seen: Set<string> = new Set()): Schema {
  if (!isObj(schema)) return {};
  const ref = schema.$ref;
  if (typeof ref !== 'string') return schema;
  if (seen.has(ref)) return {};
  seen.add(ref);
  return deref(raw, resolveRef(raw, ref), seen);
}

const PERMISSION = /\*\*Required permission:\*\*\s*`([^`]+)`\.?\s*/;

export function parseSpec(raw: Json): Spec {
  const servers = raw.servers as Array<{ url: string }> | undefined;
  const baseUrl = (servers?.[0]?.url ?? '').replace(/\/$/, '');
  const tagMeta = new Map<string, string>();
  for (const t of (raw.tags as Array<{ name: string; description?: string }> | undefined) ?? [])
    tagMeta.set(t.name, t.description ?? '');

  const byTag = new Map<string, Operation[]>();
  const paths = (raw.paths as Record<string, Json> | undefined) ?? {};
  for (const [path, item] of Object.entries(paths)) {
    // The public reference covers the API-key routes: not the nested per-workspace or admin ones.
    if (path.includes('{workspaceId}') || path.startsWith('/api/v1/admin')) continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!isObj(op)) continue;
      const security = (op.security as Array<Json> | undefined) ?? [];
      if (!security.some((s) => 'bearerAuth' in s)) continue;
      const tag = (op.tags as string[] | undefined)?.[0] ?? 'Other';
      const summary = String(op.summary ?? `${method.toUpperCase()} ${path}`);
      let description = String(op.description ?? '');
      let permission: string | null = null;
      const pm = PERMISSION.exec(description);
      if (pm) {
        permission = pm[1]!;
        description = description.replace(PERMISSION, '').trim();
      }

      const params: Param[] = [];
      for (const p of [
        ...((item.parameters as unknown[]) ?? []),
        ...((op.parameters as unknown[]) ?? []),
      ]) {
        const d = deref(raw, p) as unknown as Param;
        if (d?.name && d.in !== 'cookie' && !(d.in === 'header' && /^x-csrf-token$/i.test(d.name)))
          params.push({ ...d, required: Boolean(d.required), schema: deref(raw, d.schema) });
      }

      let body: Operation['body'] = null;
      const rb = deref(raw, op.requestBody);
      const content = isObj(rb.content) ? rb.content : {};
      const ctype = Object.keys(content)[0];
      if (ctype) {
        const media = content[ctype];
        body = {
          required: Boolean(rb.required),
          contentType: ctype,
          schema: deref(raw, isObj(media) ? media.schema : {}),
        };
      }

      const responses: Operation['responses'] = [];
      for (const [status, r] of Object.entries((op.responses as Record<string, unknown>) ?? {})) {
        const rr = deref(raw, r);
        const rc = isObj(rr.content) ? rr.content : {};
        const ct = Object.keys(rc)[0] ?? null;
        const media = ct ? rc[ct] : null;
        responses.push({
          status,
          description: String(rr.description ?? ''),
          schema: ct && isObj(media) && media.schema ? deref(raw, media.schema) : null,
          contentType: ct,
        });
      }

      const list = byTag.get(tag) ?? [];
      list.push({
        id: String(op.operationId ?? `${method}_${path}`),
        slug: '',
        tag,
        tagSlug: slug(tag),
        method,
        path,
        summary,
        description,
        permission,
        params,
        body,
        responses,
      });
      byTag.set(tag, list);
    }
  }

  const order = [...tagMeta.keys()];
  const tags: Tag[] = [...byTag.entries()]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([name, operations]) => {
      const used = new Map<string, number>();
      for (const op of operations) {
        const base = slug(op.summary) || `${op.method}-${slug(op.path)}`;
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        op.slug = n === 0 ? base : `${base}-${n + 1}`;
      }
      return { name, slug: slug(name), description: tagMeta.get(name) ?? '', operations };
    });
  return { raw, baseUrl, tags };
}

export const allOperations = (spec: Spec): Operation[] => spec.tags.flatMap((t) => t.operations);
export const findOperation = (spec: Spec, tag: string, op: string): Operation | undefined =>
  spec.tags.find((t) => t.slug === tag)?.operations.find((o) => o.slug === op);
export const operationPath = (o: Operation): string => `/docs/api/${o.tagSlug}/${o.slug}`;

// ---- schemas ----------------------------------------------------------------------------------

type S = Schema;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A short human type: `string`, `string | null`, `integer (301 | 302)`, `Link[]`, `object`. */
export function typeLabel(raw: Json, schema: S): string {
  const s = deref(raw, schema);
  if ('const' in s) return JSON.stringify(s.const);
  const any = arr(s.anyOf ?? s.oneOf);
  if (any.length) {
    const parts = [...new Set(any.map((x) => typeLabel(raw, x as S)))];
    return parts.join(' | ');
  }
  const enumVals = arr(s.enum);
  if (enumVals.length && enumVals.length <= 8) {
    return enumVals.map((v) => JSON.stringify(v)).join(' | ');
  }
  const t = Array.isArray(s.type)
    ? (s.type as string[]).join(' | ')
    : (s.type as string | undefined);
  if (t === 'array') return `${typeLabel(raw, (s.items as S) ?? {})}[]`;
  if (t === 'string' && typeof s.format === 'string') return `string (${s.format})`;
  if (t) return t;
  return isObj(s.properties) ? 'object' : 'any';
}

export function constraintsOf(raw: Json, schema: S): string[] {
  const s = nonNull(raw, schema);
  const out: string[] = [];
  if (typeof s.minLength === 'number') out.push(`min length ${s.minLength}`);
  if (typeof s.maxLength === 'number') out.push(`max length ${s.maxLength}`);
  if (typeof s.minimum === 'number') out.push(`min ${s.minimum}`);
  if (typeof s.maximum === 'number') out.push(`max ${s.maximum}`);
  if (typeof s.maxItems === 'number') out.push(`max ${s.maxItems} items`);
  const en = arr(s.enum);
  if (en.length > 8) out.push(`one of ${en.length} values`);
  if ('default' in s) out.push(`default ${JSON.stringify(s.default)}`);
  return out;
}

/** For `anyOf: [X, null]` returns X, so constraints and descriptions come from the real type. */
export function nonNull(raw: Json, schema: S): S {
  const s = deref(raw, schema);
  const any = arr(s.anyOf ?? s.oneOf).map((x) => deref(raw, x));
  const real = any.filter((x) => x.type !== 'null');
  return real.length === 1
    ? { ...real[0]!, description: s.description ?? real[0]!.description }
    : s;
}

export interface Row {
  name: string;
  type: string;
  required: boolean;
  description: string;
  constraints: string[];
  children: Row[];
}

/** Property rows for an object schema (or an array of objects), nested up to `depth` levels. */
export function rowsOf(raw: Json, schema: S, depth = 3, seen: string[] = []): Row[] {
  const s = nonNull(raw, schema);
  if (s.type === 'array' && isObj(s.items)) return rowsOf(raw, s.items as S, depth, seen);
  const props = isObj(s.properties) ? s.properties : {};
  const required = new Set(arr(s.required).map(String));
  return Object.entries(props).map(([name, p]) => {
    const prop = nonNull(raw, p as S);
    const refName = isObj(p) && typeof p.$ref === 'string' ? p.$ref : '';
    const nested =
      depth > 1 && !seen.includes(refName || name)
        ? rowsOf(raw, prop, depth - 1, refName ? [...seen, refName] : seen)
        : [];
    return {
      name,
      type: typeLabel(raw, p as S),
      required: required.has(name),
      description: String(prop.description ?? ''),
      constraints: constraintsOf(raw, p as S),
      children: nested,
    };
  });
}

const NAME_HINTS: Array<[RegExp, unknown]> = [
  [/^(destinationurl|url|endpoint)$/i, 'https://example.com/summer-sale'],
  [/^slug$/i, 'summer-sale'],
  [/^shorturl$/i, 'https://go.example.com/summer-sale'],
  [/^hostname$/i, 'go.example.com'],
  [/^(name|title)$/i, 'Summer sale'],
  [/^(foreground|background)color$/i, '#000000'],
  [/^utm/i, 'newsletter'],
  [/^(from|to)$/i, '2026-10-01'],
  [/^timezone$/i, 'UTC'],
];

/** A plausible example value built from a schema. Uses `example`/`default` when the schema has one. */
export function exampleOf(raw: Json, schema: S, name = '', depth = 0): unknown {
  const s = nonNull(raw, schema);
  if ('example' in s) return s.example;
  if ('const' in s) return s.const;
  const any = arr(s.anyOf ?? s.oneOf);
  if (any.length) return exampleOf(raw, any[0] as S, name, depth);
  const en = arr(s.enum);
  if (en.length) return en[0];
  if ('default' in s && s.default !== null) return s.default;
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  switch (t) {
    case 'string': {
      if (s.format === 'date-time') return '2026-10-01T09:30:00.000Z';
      if (s.format === 'date') return '2026-10-01';
      if (s.format === 'email') return 'ada@example.com';
      const hint = NAME_HINTS.find(([re]) => re.test(name));
      if (hint) return hint[1];
      if (/id$/i.test(name) || name === 'cursor') return 'cm0abc123def456';
      return 'string';
    }
    case 'integer':
    case 'number':
      return typeof s.minimum === 'number'
        ? s.minimum
        : /clicks|count|scans|visitors/i.test(name)
          ? 128
          : 1;
    case 'boolean':
      return true;
    case 'array':
      return depth > 3 ? [] : [exampleOf(raw, (s.items as S) ?? {}, name, depth + 1)];
    case 'object':
    default: {
      if (!isObj(s.properties)) return {};
      if (depth > 3) return {};
      const out: Json = {};
      for (const [k, v] of Object.entries(s.properties))
        out[k] = exampleOf(raw, v as S, k, depth + 1);
      return out;
    }
  }
}

/** A minimal request body: required properties only (or the first few, when none are marked). */
export function requestExample(raw: Json, schema: S): unknown {
  const s = nonNull(raw, schema);
  const props = isObj(s.properties) ? s.properties : {};
  const required = arr(s.required).map(String);
  const keys = required.length ? required : Object.keys(props).slice(0, 3);
  const out: Json = {};
  for (const k of keys) if (k in props) out[k] = exampleOf(raw, props[k] as S, k);
  return out;
}

// ---- code samples -------------------------------------------------------------------------------

export type Lang = 'curl' | 'javascript' | 'python';
export const LANGS: Array<{ id: Lang; label: string; hl: string }> = [
  { id: 'curl', label: 'cURL', hl: 'bash' },
  { id: 'javascript', label: 'JavaScript', hl: 'javascript' },
  { id: 'python', label: 'Python', hl: 'python' },
];

export interface Sample {
  url: string;
  query: Array<[string, string]>;
  body: unknown | null;
  method: string;
}

/** Builds the concrete request used by every sample: path params filled, required query params added. */
export function sampleFor(spec: Spec, op: Operation): Sample {
  const path = op.path.replace(
    /\{(\w+)\}/g,
    (_, n: string) => exampleOf(spec.raw, paramSchema(op, n), n) as string,
  );
  const query: Array<[string, string]> = op.params
    .filter((p) => p.in === 'query' && p.required)
    .map((p) => [p.name, String(exampleOf(spec.raw, p.schema, p.name))]);
  return {
    url: `${spec.baseUrl || 'https://app.example.com'}${path}`,
    query,
    body: op.body ? requestExample(spec.raw, op.body.schema) : null,
    method: op.method.toUpperCase(),
  };
}
const paramSchema = (op: Operation, name: string): S =>
  op.params.find((p) => p.name === name)?.schema ?? { type: 'string' };

const withQuery = (s: Sample) =>
  s.query.length
    ? `${s.url}?${s.query.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`
    : s.url;
const json = (v: unknown, indent = 2) => JSON.stringify(v, null, indent);

export function snippet(lang: Lang, s: Sample): string {
  const url = withQuery(s);
  if (lang === 'curl') {
    const parts = [
      `curl ${s.method === 'GET' ? '' : `-X ${s.method} `}"${url}"`,
      `  -H "Authorization: Bearer $GOSHORT_API_KEY"`,
    ];
    if (s.body !== null) {
      parts.push(`  -H "Content-Type: application/json"`);
      parts.push(`  -d '${JSON.stringify(s.body)}'`);
    }
    return parts.join(' \\\n');
  }
  if (lang === 'javascript') {
    const opts: string[] = [
      `  method: '${s.method}',`,
      `  headers: {`,
      `    Authorization: \`Bearer \${process.env.GOSHORT_API_KEY}\`,`,
    ];
    if (s.body !== null) opts.push(`    'Content-Type': 'application/json',`);
    opts.push(`  },`);
    if (s.body !== null)
      opts.push(`  body: JSON.stringify(${json(s.body).replace(/\n/g, '\n  ')}),`);
    return `const res = await fetch('${url}', {\n${opts.join('\n')}\n});\nconst { data } = await res.json();`;
  }
  const lines = [
    `import os, requests`,
    ``,
    `res = requests.${s.method.toLowerCase()}(`,
    `    "${url}",`,
    `    headers={"Authorization": f"Bearer {os.environ['GOSHORT_API_KEY']}"},`,
  ];
  if (s.body !== null) lines.push(`    json=${pyLiteral(s.body)},`);
  lines.push(`)`, `data = res.json()["data"]`);
  return lines.join('\n');
}

function pyLiteral(v: unknown): string {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (Array.isArray(v)) return `[${v.map(pyLiteral).join(', ')}]`;
  if (isObj(v))
    return `{${Object.entries(v)
      .map(([k, x]) => `${JSON.stringify(k)}: ${pyLiteral(x)}`)
      .join(', ')}}`;
  return JSON.stringify(v);
}
