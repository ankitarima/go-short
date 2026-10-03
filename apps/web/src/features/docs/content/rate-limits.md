---
title: Rate limits
description: How many requests you can make, and how to handle 429 responses.
area: api
section: Overview
order: 5
---

Limits protect the service for everyone. When you exceed one you receive `429 Too Many Requests` with a `Retry-After` header (seconds).

## Limits

| Scope               | Default limit                                                           |
| ------------------- | ----------------------------------------------------------------------- |
| Each API key        | 600 requests per minute (the operator of your instance can change this) |
| Link creation       | 120 per minute per workspace                                            |
| QR code creation    | 60 per minute per workspace                                             |
| Logo uploads        | 30 per hour per workspace                                               |
| Analytics export    | 5 per minute per workspace                                              |
| Domain verification | 10 per minute per workspace                                             |

API key responses include `RateLimit-Limit` and `RateLimit-Remaining` headers so you can slow down before hitting the limit.

## Handling 429

```javascript
async function call(url, options, attempt = 0) {
  const res = await fetch(url, options);
  if (res.status !== 429 || attempt >= 5) return res;
  const wait = Number(res.headers.get('Retry-After') ?? 1) * 1000;
  await new Promise((resolve) => setTimeout(resolve, wait));
  return call(url, options, attempt + 1);
}
```

Spread bulk work out over time rather than sending bursts.
