import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode as encodeJpeg } from 'jpeg-js';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { contrastRatio } from '../src/qr/render';
import { LocalStorageProvider } from '@go-short/shared';
import {
  type Client,
  createWorkspace,
  del,
  get,
  makeCtx,
  patch,
  post,
  registerUser,
  resetDb,
} from './helpers';

const ctx = makeCtx();
const app = createApp(ctx);
beforeEach(() => resetDb(ctx));
afterAll(async () => {
  await ctx.redis.quit();
  await ctx.prisma.$disconnect();
});

const Q = (ws: string, rest = '') => `/api/v1/workspaces/${ws}/qr${rest}`;
const L = (ws: string) => `/api/v1/workspaces/${ws}/links`;

let slugCounter = 2026;
// Slugs on the shared domain are unique across tenants, so each workspace gets its own.
async function setup() {
  const c = await registerUser(app);
  const ws = await createWorkspace(c);
  const link = (
    await post(c, L(ws), {
      destinationUrl: 'https://example.org/register',
      slug: `aiss${++slugCounter}`,
    }).expect(201)
  ).body.data as { id: string; shortUrl: string };
  return { c, ws, link };
}

/** Decode a PNG with a real QR reader. */
function scan(png: Buffer): string | null {
  const img = PNG.sync.read(png);
  return jsQR(new Uint8ClampedArray(img.data), img.width, img.height)?.data ?? null;
}

function solidPng(
  w: number,
  h: number,
  rgba: [number, number, number, number] = [220, 30, 30, 255],
): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) png.data.set(rgba, i * 4);
  return PNG.sync.write(png);
}

const upload = (c: Client, ws: string, body: Buffer | string, type: string) =>
  c.agent.post(Q(ws, '/logos')).set('X-CSRF-Token', c.csrf).set('Content-Type', type).send(body);

describe('QR generation', () => {
  it('creates an SVG QR that encodes the short URL with a scan marker (default settings)', async () => {
    const { c, ws, link } = await setup();
    const res = await post(c, Q(ws), { name: 'Registration Poster', linkId: link.id }).expect(201);
    const d = res.body.data;
    expect(d).toMatchObject({
      name: 'Registration Poster',
      linkId: link.id,
      format: 'svg',
      size: 512,
      margin: 2,
      errorCorrection: 'M',
      foregroundColor: '#000000',
      backgroundColor: '#FFFFFF',
      hasLogo: false,
      mimeType: 'image/svg+xml',
      encoding: 'utf8',
    });
    expect(d.url).toBe(`${link.shortUrl}?qr=${d.id}`);
    expect(d.data.startsWith('<svg')).toBe(true);
    expect(d.data).toContain('viewBox');
    expect(d.data).not.toMatch(/<script|javascript:|onload|<foreignObject/i);
  });

  it('PNG output is a real PNG of the requested size that scans back to the short URL', async () => {
    const { c, ws, link } = await setup();
    const d = (
      await post(c, Q(ws), {
        name: 'P',
        linkId: link.id,
        format: 'png',
        size: 600,
        margin: 4,
        errorCorrection: 'Q',
      }).expect(201)
    ).body.data;
    expect(d).toMatchObject({ mimeType: 'image/png', encoding: 'base64', errorCorrection: 'Q' });
    const png = Buffer.from(d.data, 'base64');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(PNG.sync.read(png).width).toBeGreaterThanOrEqual(580);
    expect(scan(png)).toBe(d.url);
  });

  it('custom colours still scan', async () => {
    const { c, ws, link } = await setup();
    const d = (
      await post(c, Q(ws), {
        name: 'P',
        linkId: link.id,
        format: 'png',
        foregroundColor: '#1a3a8a',
        backgroundColor: '#ffeeaa',
      }).expect(201)
    ).body.data;
    expect(d).toMatchObject({ foregroundColor: '#1A3A8A', backgroundColor: '#FFEEAA' });
    expect(scan(Buffer.from(d.data, 'base64'))).toBe(d.url);
  });

  it('serves the image directly (inline / download / override size and format) with a locked-down CSP', async () => {
    const { c, ws, link } = await setup();
    const id = (await post(c, Q(ws), { name: 'P', linkId: link.id }).expect(201)).body.data.id;
    const svg = await get(c, Q(ws, `/${id}/image`)).expect(200);
    expect(svg.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(svg.headers['content-disposition']).toBe(`inline; filename="qr-${id}.svg"`);
    expect(svg.headers['content-security-policy']).toContain("default-src 'none'");
    expect(svg.headers['content-security-policy']).toContain('sandbox');
    const png = await get(c, Q(ws, `/${id}/image?format=png&size=256&download=1`))
      .buffer(true)
      .parse((r, cb) => {
        const b: Buffer[] = [];
        r.on('data', (x: Buffer) => b.push(x));
        r.on('end', () => cb(null, Buffer.concat(b)));
      })
      .expect(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-disposition']).toBe(`attachment; filename="qr-${id}.png"`);
    expect(scan(png.body as Buffer)).toContain(`?qr=${id}`);
    await get(c, Q(ws, `/${id}/image?size=99999`)).expect(400);
    await get(c, Q(ws, `/${id}/image?format=gif`)).expect(400);
  });

  it('a link is a QR code and a campaign asset: campaign defaults to the link’s and can be overridden', async () => {
    const { c, ws, link } = await setup();
    const camp = (
      await post(c, `/api/v1/workspaces/${ws}/campaigns`, { name: 'AISS 2026' }).expect(201)
    ).body.data;
    await c.agent
      .patch(`${L(ws)}/${link.id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ campaignId: camp.id })
      .expect(200);
    const inherited = (await post(c, Q(ws), { name: 'A', linkId: link.id }).expect(201)).body.data;
    expect(inherited.campaignId).toBe(camp.id);
    const detached = (
      await post(c, Q(ws), { name: 'B', linkId: link.id, campaignId: null }).expect(201)
    ).body.data;
    expect(detached.campaignId).toBeNull();
    expect(
      (await get(c, `/api/v1/workspaces/${ws}/campaigns/${camp.id}`)).body.data.qrCodeCount,
    ).toBe(1);
  });

  it('rejects out-of-range or malformed settings', async () => {
    const { c, ws, link } = await setup();
    const bad: object[] = [
      { size: 127 },
      { size: 2049 },
      { size: 512.5 },
      { margin: 11 },
      { margin: -1 },
      { errorCorrection: 'X' },
      { format: 'gif' },
      { foregroundColor: 'red' },
      { foregroundColor: '#fff' },
      { foregroundColor: 'javascript:alert(1)' },
      { backgroundColor: '#GGGGGG' },
      { foregroundColor: '"/><script>alert(1)</script>' },
      { name: '' },
      { name: 'x'.repeat(121) },
    ];
    for (const extra of bad)
      await post(c, Q(ws), { name: 'N', linkId: link.id, ...extra }).expect(400);
  });

  it('refuses codes that would not scan: identical, inverted or low-contrast colours', async () => {
    const { c, ws, link } = await setup();
    const t = (fg: string, bg: string) =>
      post(c, Q(ws), { name: 'N', linkId: link.id, foregroundColor: fg, backgroundColor: bg });
    await t('#000000', '#000000').expect(400);
    await t('#FFFFFF', '#000000').expect(400); // inverted
    await t('#777777', '#888888').expect(400); // contrast < 3:1
    await t('#000000', '#FFFFFF').expect(201);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('unknown / foreign links and campaigns are 404', async () => {
    const a = await setup();
    const b = await setup();
    await post(a.c, Q(a.ws), { name: 'N', linkId: 'nope' }).expect(404);
    await post(b.c, Q(b.ws), { name: 'N', linkId: a.link.id }).expect(404);
    const campA = (
      await post(a.c, `/api/v1/workspaces/${a.ws}/campaigns`, { name: 'A' }).expect(201)
    ).body.data;
    await post(b.c, Q(b.ws), { name: 'N', linkId: b.link.id, campaignId: campA.id }).expect(404);
  });
});

describe('QR logos', () => {
  it('accepts PNG and JPEG, stores a sanitized PNG no larger than 256px, outside any executable path', async () => {
    const { c, ws } = await setup();
    const png = (await upload(c, ws, solidPng(1000, 600), 'image/png').expect(201)).body.data;
    expect(png.logoPath).toMatch(new RegExp(`^logos/${ws}/[A-Za-z0-9_-]+\\.png$`));
    const stored = PNG.sync.read((await ctx.storage.get(png.logoPath))!);
    expect(Math.max(stored.width, stored.height)).toBeLessThanOrEqual(256);
    expect(stored.width / stored.height).toBeCloseTo(1000 / 600, 1);

    const jpg = Buffer.from(
      encodeJpeg({ width: 64, height: 64, data: Buffer.alloc(64 * 64 * 4, 200) }, 80).data,
    );
    const j = (await upload(c, ws, jpg, 'image/jpeg').expect(201)).body.data;
    expect((await ctx.storage.get(j.logoPath))!.subarray(0, 4).toString('hex')).toBe('89504e47'); // re-encoded as PNG
  });

  it('strips metadata: text chunks and trailing payloads do not survive', async () => {
    const { c, ws } = await setup();
    const base = solidPng(32, 32);
    // Insert a tEXt chunk carrying a marker right after the IHDR chunk, and append junk after IEND.
    const marker = Buffer.from('SECRET-EXIF-MARKER');
    const chunkData = Buffer.concat([Buffer.from('Comment\0'), marker]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(chunkData.length);
    const type = Buffer.from('tEXt');
    const crcBuf = Buffer.alloc(4); // CRC value is not validated by the decoder we use for this probe
    const withText = Buffer.concat([
      base.subarray(0, 33),
      len,
      type,
      chunkData,
      crcBuf,
      base.subarray(33),
      Buffer.from('<script>alert(1)</script>'),
    ]);
    expect(withText.includes(marker)).toBe(true);
    const res = await upload(c, ws, withText, 'image/png');
    if (res.status === 201) {
      const stored = (await ctx.storage.get(res.body.data.logoPath))!;
      expect(stored.includes(marker)).toBe(false);
      expect(stored.includes(Buffer.from('<script>'))).toBe(false);
    } else {
      expect(res.status).toBe(400); // a decoder that rejects the tampered chunk is also acceptable
    }
  });

  it.each([
    [
      'SVG labelled as an image',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'image/png',
      400,
    ],
    ['SVG content type', Buffer.from('<svg/>'), 'image/svg+xml', 415],
    [
      'GIF bytes labelled PNG',
      Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00;', 'binary'),
      'image/png',
      400,
    ],
    ['HTML labelled JPEG', Buffer.from('<html><script>1</script></html>'), 'image/jpeg', 400],
    [
      'corrupt PNG',
      Buffer.concat([solidPng(8, 8).subarray(0, 40), Buffer.from('garbage')]),
      'image/png',
      400,
    ],
    ['empty body', Buffer.alloc(0), 'image/png', 415],
    ['unsupported type', Buffer.from('hello'), 'text/plain', 415],
  ])('rejects %s', async (_n, body, type, status) => {
    const { c, ws } = await setup();
    await upload(c, ws, body, type).expect(status);
  });

  it('rejects oversized files (413) and decompression bombs declared in the header (400)', async () => {
    const { c, ws } = await setup();
    await upload(
      c,
      ws,
      Buffer.concat([solidPng(8, 8), Buffer.alloc(600 * 1024)]),
      'image/png',
    ).expect(413);
    // A valid-looking PNG header that claims 60000x60000 pixels.
    const bomb = Buffer.from(solidPng(8, 8));
    bomb.writeUInt32BE(60000, 16);
    bomb.writeUInt32BE(60000, 20);
    const res = await upload(c, ws, bomb, 'image/png').expect(400);
    expect(res.body.error.message).toMatch(/dimensions/);
  });

  it('a QR with a logo forces error correction H, still scans (PNG), and the SVG embeds only a data-URI PNG', async () => {
    const { c, ws, link } = await setup();
    const { logoPath } = (
      await upload(c, ws, solidPng(120, 120, [30, 90, 200, 255]), 'image/png').expect(201)
    ).body.data;
    const png = (
      await post(c, Q(ws), {
        name: 'Logo',
        linkId: link.id,
        format: 'png',
        size: 800,
        errorCorrection: 'L',
        logoPath,
      }).expect(201)
    ).body.data;
    expect(png).toMatchObject({ errorCorrection: 'H', hasLogo: true });
    expect(scan(Buffer.from(png.data, 'base64'))).toBe(png.url);

    const svg = (
      await post(c, Q(ws), { name: 'Logo SVG', linkId: link.id, format: 'svg', logoPath }).expect(
        201,
      )
    ).body.data.data as string;
    expect(svg).toMatch(/<image [^>]*href="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
    expect(svg).not.toMatch(/<script|javascript:|onload|<foreignObject|xlink:href="http/i);
    expect((svg.match(/<image /g) ?? []).length).toBe(1);
  });

  it('logo paths are tenant-bound: foreign, traversal and missing paths are 404', async () => {
    const a = await setup();
    const b = await setup();
    const { logoPath } = (await upload(a.c, a.ws, solidPng(40, 40), 'image/png').expect(201)).body
      .data;
    await post(b.c, Q(b.ws), { name: 'N', linkId: b.link.id, logoPath }).expect(404); // other workspace's logo
    await post(a.c, Q(a.ws), {
      name: 'N',
      linkId: a.link.id,
      logoPath: `logos/${a.ws}/../${b.ws}/x.png`,
    }).expect(404);
    await post(a.c, Q(a.ws), {
      name: 'N',
      linkId: a.link.id,
      logoPath: `logos/${a.ws}/does-not-exist.png`,
    }).expect(404);
    await post(a.c, Q(a.ws), { name: 'N', linkId: a.link.id, logoPath: '/etc/passwd' }).expect(404);
    await post(a.c, Q(a.ws), { name: 'N', linkId: a.link.id, logoPath }).expect(201);
  });

  it('honours the QR logos feature flag', async () => {
    const off = createApp({ ...ctx, config: { ...ctx.config, FEATURE_QR_LOGOS: false } });
    const agent = (await import('supertest')).default.agent(off);
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ email: 'f@example.com', name: 'F', password: 'correct-horse-battery' });
    const h = { 'X-CSRF-Token': reg.body.data.csrfToken as string };
    const w = (await agent.post('/api/v1/workspaces').set(h).send({ name: 'W' })).body.data.id;
    const res = await agent
      .post(Q(w, '/logos'))
      .set(h)
      .set('Content-Type', 'image/png')
      .send(solidPng(8, 8));
    expect(res.status).toBe(403);
  });

  it('rate limits logo uploads per workspace', async () => {
    const { c, ws } = await setup();
    const png = solidPng(8, 8);
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await upload(c, ws, png, 'image/png')).status);
    expect(codes[29]).toBe(201);
    expect(codes[30]).toBe(429);
  });
});

describe('QR management', () => {
  it('lists with cursor + filters; PATCH validates the merged style; DELETE removes the record and an unused logo', async () => {
    const { c, ws, link } = await setup();
    const { logoPath } = (await upload(c, ws, solidPng(40, 40), 'image/png').expect(201)).body.data;
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C'])
      ids.push(
        (
          await post(c, Q(ws), {
            name,
            linkId: link.id,
            ...(name === 'A' ? { logoPath } : {}),
          }).expect(201)
        ).body.data.id,
      );
    const first = (await get(c, Q(ws, '?limit=2')).expect(200)).body;
    expect(first.data.map((q: { name: string }) => q.name)).toEqual(['C', 'B']);
    expect(
      (await get(c, Q(ws, `?limit=2&cursor=${first.nextCursor}`))).body.data.map(
        (q: { name: string }) => q.name,
      ),
    ).toEqual(['A']);
    expect((await get(c, Q(ws, `?linkId=${link.id}`))).body.data).toHaveLength(3);
    expect(JSON.stringify(first)).not.toContain('logos/'); // storage paths are not exposed

    await patch(c, Q(ws, `/${ids[1]}`), { foregroundColor: '#FFFFFF' }).expect(400); // would invert
    const upd = (
      await patch(c, Q(ws, `/${ids[1]}`), {
        name: 'B2',
        size: 1024,
        foregroundColor: '#102030',
      }).expect(200)
    ).body.data;
    expect(upd).toMatchObject({ name: 'B2', size: 1024, foregroundColor: '#102030' });
    await patch(c, Q(ws, `/${ids[1]}`), {}).expect(400);

    expect(await ctx.storage.exists(logoPath)).toBe(true);
    await patch(c, Q(ws, `/${ids[0]}`), { logoPath: null }).expect(200); // removing the logo deletes the unused file
    expect(await ctx.storage.exists(logoPath)).toBe(false);
    await del(c, Q(ws, `/${ids[2]}`)).expect(200);
    await get(c, Q(ws, `/${ids[2]}`)).expect(404);
  });

  it('IDOR: another workspace cannot read, render, change or delete a QR code', async () => {
    const a = await setup();
    const m = await setup();
    const id = (await post(a.c, Q(a.ws), { name: 'N', linkId: a.link.id }).expect(201)).body.data
      .id;
    for (const ws of [m.ws, a.ws]) {
      await get(m.c, Q(ws, `/${id}`)).expect(404);
      await get(m.c, Q(ws, `/${id}/image`)).expect(404);
      await patch(m.c, Q(ws, `/${id}`), { name: 'x' }).expect(404);
      await del(m.c, Q(ws, `/${id}`)).expect(404);
    }
    expect((await get(m.c, Q(m.ws))).body.data).toEqual([]);
  });

  it('viewer can read and download but not create, upload or delete', async () => {
    const { c: owner, ws, link } = await setup();
    const viewer = await registerUser(app);
    await post(owner, `/api/v1/workspaces/${ws}/members/invite`, {
      email: viewer.email,
      role: 'VIEWER',
    }).expect(201);
    await post(viewer, '/api/v1/workspaces/invitations/accept', {
      token: ctx.email.lastToken(),
    }).expect(200);
    const id = (await post(owner, Q(ws), { name: 'N', linkId: link.id }).expect(201)).body.data.id;
    await get(viewer, Q(ws)).expect(200);
    await get(viewer, Q(ws, `/${id}/image`)).expect(200);
    await post(viewer, Q(ws), { name: 'x', linkId: link.id }).expect(403);
    await upload(viewer, ws, solidPng(8, 8), 'image/png').expect(403);
    await del(viewer, Q(ws, `/${id}`)).expect(403);
  });

  it('deleting the link removes its QR codes (cascade)', async () => {
    const { c, ws, link } = await setup();
    await post(c, Q(ws), { name: 'N', linkId: link.id }).expect(201);
    await del(c, `${L(ws)}/${link.id}`).expect(200);
    expect(await ctx.prisma.qRCode.count()).toBe(0);
  });
});

describe('LocalStorageProvider', () => {
  const dir = mkdtempSync(join(tmpdir(), 'go-short-storage-'));
  const s = new LocalStorageProvider(dir);

  it('stores, reads, lists and deletes; files are owner-only', async () => {
    await s.put('logos/w1/a.png', Buffer.from('x'));
    expect(await s.exists('logos/w1/a.png')).toBe(true);
    expect((await s.get('logos/w1/a.png'))!.toString()).toBe('x');
    expect(statSync(join(dir, 'logos/w1/a.png')).mode & 0o777).toBe(0o600);
    expect((await s.list('logos')).map((f) => f.key)).toEqual(['logos/w1/a.png']);
    await s.delete('logos/w1/a.png');
    expect(await s.get('logos/w1/a.png')).toBeNull();
    await s.delete('logos/w1/a.png'); // idempotent
  });

  it.each([
    '../escape',
    '/etc/passwd',
    'a/../../b',
    'a//b',
    '',
    '.hidden',
    'a/b/../../../c',
    'a\\b',
    'a\0b',
  ])('refuses key %j', async (key) => {
    await expect(s.put(key, Buffer.from('x'))).rejects.toThrow();
    await expect(s.get(key)).rejects.toThrow();
  });

  it('never writes outside the base directory', async () => {
    await expect(s.put('..%2Fx', Buffer.from('x'))).rejects.toThrow();
    expect(() => readFileSync(join(dir, '..', 'x'))).toThrow();
  });
});

describe('QR preview (stateless)', () => {
  const preview = (c: Client, ws: string, body: object) =>
    c.agent
      .post(Q(ws, '/preview'))
      .set('X-CSRF-Token', c.csrf)
      .send(body)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  it('returns a scannable image for the chosen settings and persists nothing', async () => {
    const { c, ws, link } = await setup();
    const res = await preview(c, ws, {
      linkId: link.id,
      format: 'png',
      size: 400,
      foregroundColor: '#112233',
    }).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(scan(res.body as Buffer)).toBe(`${link.shortUrl}?qr=preview`);
    expect(await ctx.prisma.qRCode.count()).toBe(0);
    const svg = await preview(c, ws, { format: 'svg' }).expect(200);
    expect(svg.headers['content-type']).toMatch(/svg/);
    expect((svg.body as Buffer).toString()).toContain('<svg');
  });

  it('applies the same safety rules as creation (scannability, ranges, foreign links and logos)', async () => {
    const a = await setup();
    const b = await setup();
    await preview(a.c, a.ws, { foregroundColor: '#FFFFFF', backgroundColor: '#000000' }).expect(
      400,
    );
    await preview(a.c, a.ws, { size: 99999 }).expect(400);
    await preview(a.c, a.ws, { linkId: b.link.id }).expect(404);
    const { logoPath } = (await upload(b.c, b.ws, solidPng(40, 40), 'image/png').expect(201)).body
      .data;
    await preview(a.c, a.ws, { logoPath }).expect(404);
    await preview(b.c, b.ws, { logoPath, format: 'png' }).expect(200);
  });

  it('is available to viewers (read-only) but not to non-members', async () => {
    const { c: owner, ws } = await setup();
    const viewer = await registerUser(app);
    await post(owner, `/api/v1/workspaces/${ws}/members/invite`, {
      email: viewer.email,
      role: 'VIEWER',
    }).expect(201);
    await post(viewer, '/api/v1/workspaces/invitations/accept', {
      token: ctx.email.lastToken(),
    }).expect(200);
    await preview(viewer, ws, {}).expect(200);
    const stranger = await registerUser(app);
    await preview(stranger, ws, {}).expect(404);
  });
});

describe('QR preview reusing a saved logo', () => {
  it('previews with the saved QR’s logo without exposing its path; foreign QR ids are 404', async () => {
    const a = await setup();
    const b = await setup();
    const { logoPath } = (
      await upload(a.c, a.ws, solidPng(60, 60, [20, 120, 220, 255]), 'image/png').expect(201)
    ).body.data;
    const qr = (
      await post(a.c, Q(a.ws), {
        name: 'Logo QR',
        linkId: a.link.id,
        format: 'png',
        logoPath,
      }).expect(201)
    ).body.data;
    expect(JSON.stringify(qr)).not.toContain('logos/');
    const res = await a.c.agent
      .post(Q(a.ws, '/preview'))
      .set('X-CSRF-Token', a.c.csrf)
      .send({
        linkId: a.link.id,
        format: 'png',
        size: 600,
        logoFrom: qr.id,
        foregroundColor: '#102030',
      })
      .buffer(true)
      .parse((r, cb) => {
        const ch: Buffer[] = [];
        r.on('data', (d: Buffer) => ch.push(d));
        r.on('end', () => cb(null, Buffer.concat(ch)));
      })
      .expect(200);
    const img = PNG.sync.read(res.body as Buffer);
    const mid = Math.floor(img.width / 2);
    const px = (x: number, y: number) => [
      ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3),
    ];
    expect(px(mid, mid)).toEqual([20, 120, 220]); // the logo's colour sits in the centre
    expect(scan(res.body as Buffer)).toBe(`${a.link.shortUrl}?qr=preview`);
    await post(b.c, Q(b.ws, '/preview'), { logoFrom: qr.id }).expect(404);
  });
});
