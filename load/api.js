// API load test with an API key against the flat routes, while the database holds LINKS links and
// whatever click history earlier runs produced. Read-heavy mix plus a trickle of writes.
//
//   k6 run -e RATE=50 -e DURATION=60s -e BASE_URL=http://api:4000 -e API_KEY=gs_... api.js
import http from 'k6/http';
import { Rate } from 'k6/metrics';
import { droppedBudget, env, randInt, slugOf } from './lib.js';

const RATE = Number(env('RATE', '50'));
const WRITE_RATE = Number(env('WRITE_RATE', '2'));
const DURATION = env('DURATION', '60s');
const BASE = env('BASE_URL', 'http://api:4000') + '/api/v1';
const KEY = env('API_KEY', '');
const LINKS = Number(env('LINKS', '100000'));

export const options = {
  scenarios: {
    read: {
      executor: 'constant-arrival-rate',
      exec: 'read',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 200,
    },
    write: {
      executor: 'constant-arrival-rate',
      exec: 'write',
      rate: WRITE_RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 5,
      maxVUs: 50,
    },
  },
  thresholds: {
    // Informational targets for a dashboard-style API, not documented promises.
    'http_req_duration{op:list}': ['p(95)<300'],
    'http_req_duration{op:search}': ['p(95)<500'],
    'http_req_duration{op:analytics}': ['p(95)<1000'],
    'http_req_duration{op:campaigns}': ['p(95)<300'],
    'http_req_duration{op:create}': ['p(95)<500'],
    unexpected: ['rate==0'],
    dropped_iterations: [`count<=${droppedBudget(RATE + WRITE_RATE, DURATION)}`],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const unexpected = new Rate('unexpected');
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

function day(offset) {
  return new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
}

export function read() {
  const r = Math.random();
  let op, url;
  if (r < 0.4) {
    op = 'list';
    url = `${BASE}/links?limit=50`;
  } else if (r < 0.55) {
    op = 'search';
    url = `${BASE}/links?limit=50&search=${slugOf(randInt(1, LINKS)).slice(0, 5)}`;
  } else if (r < 0.8) {
    op = 'analytics';
    url = `${BASE}/analytics?from=${day(29)}&to=${day(0)}&timezone=UTC&granularity=day&includeBots=true&limit=10`;
  } else if (r < 0.9) {
    op = 'campaigns';
    url = `${BASE}/campaigns?limit=50`;
  } else {
    op = 'list';
    url = `${BASE}/links?limit=50&campaignId=lt_c${String(randInt(1, 100)).padStart(3, '0')}`;
  }
  const res = http.get(url, { headers, tags: { op } });
  unexpected.add(res.status !== 200);
}

export function write() {
  const slug = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const body = JSON.stringify({ destinationUrl: `https://example.org/w/${slug}`, slug });
  const res = http.post(`${BASE}/links`, body, { headers, tags: { op: 'create' } });
  unexpected.add(res.status !== 201);
  if (res.status === 201) {
    const id = res.json('data.id');
    const del = http.del(`${BASE}/links/${id}`, null, { headers, tags: { op: 'delete' } });
    unexpected.add(del.status !== 200);
  }
}
