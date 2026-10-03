// Redirect load test. Constant ARRIVAL rate (open model): requests keep coming at RATE per second
// whether or not the server keeps up, so overload shows up as latency/errors, not as a quietly lower rate.
//
//   k6 run -e RATE=1000 -e DURATION=60s -e BASE_URL=http://redirect:4001 -e HOST=localhost:4001 redirect.js
//
// Traffic mix (override with the env vars below): 60% HOT (1,000 popular links), 35% COLD (uniform over
// all LINKS, mostly cache misses right after a cache flush) and 5% MISS (slugs that do not exist).
// Every response status is checked against what the fixture says it must be.
import http from 'k6/http';
import { Counter, Rate } from 'k6/metrics';
import { droppedBudget, env, expectedStatus, randInt, slugOf } from './lib.js';

const RATE = Number(env('RATE', '100'));
const DURATION = env('DURATION', '60s');
const BASE_URL = env('BASE_URL', 'http://redirect:4001');
const HOST = env('HOST', 'localhost:4001');
const LINKS = Number(env('LINKS', '100000'));
const HOT = Number(env('HOT_LINKS', '1000'));
const HOT_SHARE = Number(env('HOT_SHARE', '0.60'));
const MISS_SHARE = Number(env('MISS_SHARE', '0.05'));

export const options = {
  scenarios: {
    redirect: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(20, Math.ceil(RATE / 10)),
      maxVUs: Math.max(200, RATE * 2),
    },
  },
  thresholds: {
    // The documented targets (docs/performance.md): p95 < 100 ms, p99 < 200 ms, and nothing unexpected.
    http_req_duration: ['p(50)<20', 'p(95)<100', 'p(99)<200'],
    'http_req_duration{class:hot}': ['p(95)<100'],
    'http_req_duration{class:cold}': ['p(95)<100'],
    unexpected: ['rate==0'],
    // If the generator could not start requests on time the run does not measure what it claims to.
    dropped_iterations: [`count<=${droppedBudget(RATE, DURATION)}`],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: true,
  // With several redirect replicas behind one DNS name, spread requests over all of them.
  dns: { select: 'roundRobin', ttl: '30s' },
};

http.setResponseCallback(http.expectedStatuses(302, 404, 410));
const unexpected = new Rate('unexpected');
const redirects = new Counter('redirects_302'); // = analytics events the worker must store

const AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
];
const REFERERS = [
  '',
  '',
  'https://www.google.com/',
  'https://t.co/abc',
  'https://www.instagram.com/',
];

export default function () {
  const r = Math.random();
  let cls, slug, want;
  if (r < MISS_SHARE) {
    cls = 'miss';
    slug = 'x' + Math.random().toString(36).slice(2, 10);
    want = 404;
  } else if (r < MISS_SHARE + HOT_SHARE) {
    cls = 'hot';
    const i = randInt(1, HOT);
    slug = slugOf(i);
    want = expectedStatus(i);
  } else {
    cls = 'cold';
    const i = randInt(1, LINKS);
    slug = slugOf(i);
    want = expectedStatus(i);
  }
  const res = http.get(`${BASE_URL}/${slug}`, {
    redirects: 0,
    tags: { class: cls },
    headers: {
      Host: HOST,
      'User-Agent': AGENTS[randInt(0, AGENTS.length - 1)],
      Referer: REFERERS[randInt(0, REFERERS.length - 1)],
      'Accept-Language': 'en-US,en;q=0.9',
      // The service trusts one proxy hop, so this is the "client address" analytics will see.
      'X-Forwarded-For': `${randInt(11, 223)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`,
    },
  });
  unexpected.add(res.status !== want);
  if (res.status === 302) redirects.add(1);
}
