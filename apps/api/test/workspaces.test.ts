import type { WorkspaceRole } from '@go-short/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { type Client, del, makeCtx, patch, post, registerUser, resetDb } from './helpers';

const ctx = makeCtx();
const app = createApp(ctx);
beforeEach(() => resetDb(ctx));
afterAll(async () => {
  await ctx.redis.quit();
  await ctx.prisma.$disconnect();
});

async function createWs(c: Client, name = 'Acme') {
  return (await post(c, '/api/v1/workspaces', { name }).expect(201)).body.data as {
    id: string;
    slug: string;
  };
}

/** Invite `invitee` with `role` and have them accept. */
async function addMember(
  owner: Client,
  wsId: string,
  invitee: Client,
  role: Exclude<WorkspaceRole, 'OWNER'>,
) {
  await post(owner, `/api/v1/workspaces/${wsId}/members/invite`, {
    email: invitee.email,
    role,
  }).expect(201);
  await post(invitee, '/api/v1/workspaces/invitations/accept', {
    token: ctx.email.lastToken(),
  }).expect(200);
}

describe('workspaces', () => {
  it('creator becomes OWNER; slugs are unique and auto-suffixed', async () => {
    const c = await registerUser(app);
    const a = await createWs(c, 'Acme Inc');
    const b = await createWs(c, 'Acme Inc');
    expect(a.slug).toBe('acme-inc');
    expect(b.slug).not.toBe(a.slug);
    const list = await c.agent.get('/api/v1/workspaces').expect(200);
    expect(list.body.data.map((w: { role: string }) => w.role)).toEqual(['OWNER', 'OWNER']);
    await post(c, '/api/v1/workspaces', { name: 'X', slug: 'acme-inc' }).expect(409);
  });

  it('users can have multiple workspaces and /me lists them', async () => {
    const c = await registerUser(app);
    await createWs(c, 'One');
    await createWs(c, 'Two');
    expect((await c.agent.get('/api/v1/me')).body.data.workspaces).toHaveLength(2);
  });

  it('IDOR: non-members get 404 for every workspace route; nothing leaks', async () => {
    const alice = await registerUser(app);
    const mallory = await registerUser(app);
    const ws = await createWs(alice);
    const base = `/api/v1/workspaces/${ws.id}`;
    await mallory.agent.get(base).expect(404);
    await patch(mallory, base, { name: 'pwned' }).expect(404);
    await del(mallory, base).expect(404);
    await mallory.agent.get(`${base}/members`).expect(404);
    await mallory.agent.get(`${base}/audit-logs`).expect(404);
    await post(mallory, `${base}/members/invite`, { email: 'm@example.com', role: 'ADMIN' }).expect(
      404,
    );
    expect((await alice.agent.get(base)).body.data.name).toBe('Acme');
    // Unauthenticated
    await alice.agent.get('/api/v1/me').expect(200);
  });

  it('role matrix: VIEWER read-only, MEMBER cannot manage, ADMIN cannot delete, OWNER can', async () => {
    const owner = await registerUser(app);
    const admin = await registerUser(app);
    const member = await registerUser(app);
    const viewer = await registerUser(app);
    const ws = await createWs(owner);
    const base = `/api/v1/workspaces/${ws.id}`;
    await addMember(owner, ws.id, admin, 'ADMIN');
    await addMember(owner, ws.id, member, 'MEMBER');
    await addMember(owner, ws.id, viewer, 'VIEWER');

    for (const c of [viewer, member, admin]) await c.agent.get(base).expect(200);
    await patch(viewer, base, { name: 'v' }).expect(403);
    await patch(member, base, { name: 'm' }).expect(403);
    await patch(admin, base, { name: 'Renamed' }).expect(200);

    await post(member, `${base}/members/invite`, { email: 'z@example.com', role: 'VIEWER' }).expect(
      403,
    );
    await member.agent.get(`${base}/audit-logs`).expect(403);
    await admin.agent.get(`${base}/audit-logs`).expect(200);

    await del(admin, base).expect(403);
    await del(owner, base).expect(200);
    await owner.agent.get(base).expect(404);
  });

  it('admins cannot grant or modify OWNER, nor escalate themselves', async () => {
    const owner = await registerUser(app);
    const admin = await registerUser(app);
    const ws = await createWs(owner);
    const base = `/api/v1/workspaces/${ws.id}`;
    await addMember(owner, ws.id, admin, 'ADMIN');
    const members = (await owner.agent.get(`${base}/members`)).body.data as {
      id: string;
      role: string;
      user: { id: string };
    }[];
    const adminRow = members.find((m) => m.user.id === admin.userId)!;
    const ownerRow = members.find((m) => m.user.id === owner.userId)!;

    await patch(admin, `${base}/members/${adminRow.id}`, { role: 'OWNER' }).expect(403);
    await patch(admin, `${base}/members/${ownerRow.id}`, { role: 'VIEWER' }).expect(403);
    await del(admin, `${base}/members/${ownerRow.id}`).expect(403);
    await post(admin, `${base}/members/invite`, { email: 'x@example.com', role: 'OWNER' }).expect(
      400,
    );
  });

  it('keeps at least one owner', async () => {
    const owner = await registerUser(app);
    const ws = await createWs(owner);
    const base = `/api/v1/workspaces/${ws.id}`;
    const [row] = (await owner.agent.get(`${base}/members`)).body.data as { id: string }[];
    await patch(owner, `${base}/members/${row!.id}`, { role: 'ADMIN' }).expect(409);
    await del(owner, `${base}/members/${row!.id}`).expect(409);
  });

  it('members can leave; removed members lose access', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app);
    const ws = await createWs(owner);
    const base = `/api/v1/workspaces/${ws.id}`;
    await addMember(owner, ws.id, member, 'MEMBER');
    const row = (
      (await owner.agent.get(`${base}/members`)).body.data as { id: string; user: { id: string } }[]
    ).find((m) => m.user.id === member.userId)!;
    await del(member, `${base}/members/${row.id}`).expect(200);
    await member.agent.get(base).expect(404);
  });

  it('invitations: wrong recipient, reuse and bad tokens are rejected identically', async () => {
    const owner = await registerUser(app);
    const invitee = await registerUser(app);
    const other = await registerUser(app);
    const ws = await createWs(owner);
    await post(owner, `/api/v1/workspaces/${ws.id}/members/invite`, {
      email: invitee.email,
      role: 'MEMBER',
    }).expect(201);
    const token = ctx.email.lastToken();
    await post(other, '/api/v1/workspaces/invitations/accept', { token }).expect(404);
    await post(invitee, '/api/v1/workspaces/invitations/accept', { token }).expect(200);
    await post(invitee, '/api/v1/workspaces/invitations/accept', { token }).expect(404);
    await post(invitee, '/api/v1/workspaces/invitations/accept', { token: 'x'.repeat(30) }).expect(
      404,
    );
    expect(await ctx.prisma.invitation.findFirst({ where: { tokenHash: token } })).toBeNull(); // stored hashed
  });

  it('writes audit logs without secrets and paginates with a cursor', async () => {
    const owner = await registerUser(app);
    const ws = await createWs(owner);
    const base = `/api/v1/workspaces/${ws.id}`;
    for (let i = 0; i < 3; i++) await patch(owner, base, { name: `N${i}` }).expect(200);
    const p1 = (await owner.agent.get(`${base}/audit-logs?limit=2`)).body;
    expect(p1.data).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await owner.agent.get(`${base}/audit-logs?limit=2&cursor=${p1.nextCursor}`)).body;
    expect(p2.data.length).toBeGreaterThan(0);
    expect(new Set([...p1.data, ...p2.data].map((l: { id: string }) => l.id)).size).toBe(
      p1.data.length + p2.data.length,
    );
    await owner.agent.get(`${base}/audit-logs?limit=101`).expect(400);
    expect(JSON.stringify(p1)).not.toMatch(/token|password/i);
  });

  it('validates workspace settings', async () => {
    const c = await registerUser(app);
    const ws = await createWs(c);
    const base = `/api/v1/workspaces/${ws.id}`;
    await patch(c, base, { timezone: 'Mars/Base' }).expect(400);
    await patch(c, base, {}).expect(400);
    const ok = await patch(c, base, {
      timezone: 'Asia/Kolkata',
      retentionDays: 90,
      hashIps: true,
    }).expect(200);
    expect(ok.body.data).toMatchObject({ timezone: 'Asia/Kolkata', retentionDays: 90 });
  });
});

describe('workspace overview', () => {
  it('returns scoped totals and is only visible to members', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const wa = (await createWs(a, 'A')).id;
    const wb = (await createWs(b, 'B')).id;
    await post(a, `/api/v1/workspaces/${wa}/links`, {
      destinationUrl: 'https://example.org/1',
    }).expect(201);
    await post(a, `/api/v1/workspaces/${wa}/links`, {
      destinationUrl: 'https://example.org/2',
    }).expect(201);
    await post(a, `/api/v1/workspaces/${wa}/campaigns`, { name: 'C' }).expect(201);
    await post(b, `/api/v1/workspaces/${wb}/links`, {
      destinationUrl: 'https://example.org/3',
    }).expect(201);
    const res = await a.agent.get(`/api/v1/workspaces/${wa}/overview`).expect(200);
    expect(res.body.data).toEqual({ links: 2, campaigns: 1, qrCodes: 0, domains: 0, members: 1 });
    await b.agent.get(`/api/v1/workspaces/${wa}/overview`).expect(404);
  });
});
