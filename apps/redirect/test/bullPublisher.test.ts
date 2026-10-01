import type { AnalyticsBatch, AnalyticsEvent } from '@go-short/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { BullmqPublisher } from '../src/bullPublisher';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const event = (): AnalyticsEvent => ({
  eventId: `e${n++}`,
  linkId: 'l',
  workspaceId: 'w',
  campaignId: null,
  timestamp: Date.now(),
  ip: '1.1.1.1',
  userAgent: null,
  referer: null,
  acceptLanguage: null,
  forwardedFor: null,
});

interface Call {
  name: string;
  data: AnalyticsBatch;
  opts: Record<string, unknown>;
}
function fakeQueue(behaviour: { fail: boolean } = { fail: false }) {
  const calls: Call[] = [];
  let attempts = 0;
  return {
    behaviour,
    calls,
    get attempts() {
      return attempts;
    },
    queue: {
      add: async (name: string, data: AnalyticsBatch, opts: Record<string, unknown>) => {
        attempts++;
        if (behaviour.fail) throw new Error('redis down');
        calls.push({ name, data, opts });
        return {} as never;
      },
    } as never,
  };
}
const make = (
  q: ReturnType<typeof fakeQueue>,
  o: Partial<{ flushMs: number; batchMax: number; bufferMax: number }> = {},
) =>
  new BullmqPublisher({
    queue: q.queue,
    logger: pino({ level: 'silent' }),
    flushMs: 20,
    batchMax: 10,
    bufferMax: 1000,
    ...o,
  });

describe('BullmqPublisher', () => {
  it('publish() is synchronous and returns before anything is sent', () => {
    const q = fakeQueue();
    const p = make(q);
    p.publish(event());
    expect(q.calls).toHaveLength(0);
    expect(p.pending).toBe(1);
  });

  it('flushes a partial batch after the interval, with retry/dead-letter job options and a jobId', async () => {
    const q = fakeQueue();
    const p = make(q);
    for (let i = 0; i < 3; i++) p.publish(event());
    await sleep(80);
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0]!.data.events).toHaveLength(3);
    expect(q.calls[0]!.opts).toMatchObject({ attempts: 5, jobId: q.calls[0]!.data.batchId });
    expect(q.calls[0]!.opts.removeOnFail).toBeTruthy();
    expect(p.pending).toBe(0);
  });

  it('flushes immediately when a full batch accumulates and never exceeds batchMax per job', async () => {
    const q = fakeQueue();
    const p = make(q, { flushMs: 5000 });
    for (let i = 0; i < 35; i++) p.publish(event());
    await sleep(50);
    expect(q.calls.map((c) => c.data.events.length)).toEqual([10, 10, 10]);
    expect(p.pending).toBe(5);
    await p.close();
    expect(q.calls.reduce((a, c) => a + c.data.events.length, 0)).toBe(35);
  });

  it('never throws or blocks when the queue is down; keeps events and delivers them in order after recovery', async () => {
    const q = fakeQueue({ fail: true });
    const p = make(q);
    const sent: string[] = [];
    for (let i = 0; i < 25; i++) {
      const e = event();
      sent.push(e.eventId);
      expect(() => p.publish(e)).not.toThrow();
    }
    await sleep(100);
    expect(q.calls).toHaveLength(0);
    expect(p.pending).toBe(25);
    q.behaviour.fail = false;
    await sleep(1400); // retry delay is >= 1 s
    expect(p.pending).toBe(0);
    expect(q.calls.flatMap((c) => c.data.events.map((e) => e.eventId))).toEqual(sent);
  });

  it('does not hammer a down queue: attempts stay bounded while thousands of events are published', async () => {
    const q = fakeQueue({ fail: true });
    const p = make(q, { bufferMax: 100_000 });
    for (let i = 0; i < 5000; i++) p.publish(event());
    await sleep(200);
    expect(q.attempts).toBeLessThan(10);
  });

  it('bounds memory when the queue stays down: drops the oldest events, and every event is accounted for', async () => {
    const q = fakeQueue({ fail: true });
    const p = make(q, { bufferMax: 1000, batchMax: 100 });
    const first = event();
    p.publish(first);
    for (let i = 0; i < 5000; i++) p.publish(event());
    await sleep(100); // let in-flight (failed) batches return to the buffer
    expect(p.pending).toBeLessThanOrEqual(1000);
    expect(p.dropped + p.pending).toBe(5001); // nothing vanished silently
    q.behaviour.fail = false;
    await p.close();
    expect(p.pending).toBe(0);
    const delivered = q.calls.flatMap((c) => c.data.events.map((e) => e.eventId));
    expect(delivered).not.toContain(first.eventId); // the oldest were the ones dropped
    expect(delivered.length + p.dropped).toBe(5001);
  });

  it('does not strand a partial batch after recovery when no new clicks arrive', async () => {
    const q = fakeQueue({ fail: true });
    const p = make(q, { batchMax: 10 });
    for (let i = 0; i < 25; i++) p.publish(event());
    await sleep(50);
    q.behaviour.fail = false;
    await sleep(1500);
    expect(p.pending).toBe(0);
    expect(q.calls.reduce((a, c) => a + c.data.events.length, 0)).toBe(25);
  });

  it('close() drains the buffer on shutdown, and reports (does not hang on) a dead queue', async () => {
    const ok = fakeQueue();
    const p = make(ok, { flushMs: 60_000 });
    for (let i = 0; i < 7; i++) p.publish(event());
    await p.close();
    expect(ok.calls.flatMap((c) => c.data.events)).toHaveLength(7);

    const dead = fakeQueue({ fail: true });
    const p2 = make(dead, { flushMs: 60_000 });
    p2.publish(event());
    const t0 = Date.now();
    await p2.close(300);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(p2.pending).toBe(1);
  });

  it('a synchronously throwing queue is also contained', async () => {
    const q = {
      add: () => {
        throw new Error('sync boom');
      },
    } as never;
    const p = new BullmqPublisher({
      queue: q,
      logger: pino({ level: 'silent' }),
      flushMs: 10,
      batchMax: 5,
      bufferMax: 100,
    });
    p.publish(event());
    await sleep(50);
    expect(p.pending).toBe(1);
  });
});
