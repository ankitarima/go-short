---
title: Webhooks
description: Get notified when things change, and verify that requests really come from goShort.
area: guides
section: Guides
order: 9
---

A webhook sends an HTTPS `POST` to your server when something happens in a workspace. Admins and owners manage them under **Settings → Webhooks** (**Add webhook**).

## Events

| Event              | Sent when                                |
| ------------------ | ---------------------------------------- |
| `link.created`     | A link is created.                       |
| `link.updated`     | A link is changed.                       |
| `link.deleted`     | A link is deleted.                       |
| `campaign.created` | A campaign is created.                   |
| `domain.verified`  | A custom domain passes DNS verification. |

You choose which events each webhook receives. A workspace can have up to 10 webhooks. Use **Test** to send a sample event.

## What a delivery looks like

The `data` object holds the affected resource: `link`, `campaign` or the verified `domain`. The example below is shortened.

```json
{
  "id": "del_2f6c0a1e-…",
  "type": "link.created",
  "createdAt": "2026-10-01T09:30:00.000Z",
  "workspaceId": "cm…",
  "data": {
    "link": { "id": "cm…", "slug": "summer-sale", "destinationUrl": "https://example.com/sale" }
  }
}
```

Headers sent with every delivery:

| Header                | Meaning                               |
| --------------------- | ------------------------------------- |
| `X-GoShort-Event`     | The event type.                       |
| `X-GoShort-Delivery`  | A unique id for this delivery.        |
| `X-GoShort-Signature` | `t=<unix seconds>,v1=<hex signature>` |

## Verify the signature

The signature is `HMAC-SHA256(secret, "<t>.<raw body>")`. Always verify it, compare in constant time, and reject old timestamps (more than 5 minutes) to prevent replays.

```javascript
import crypto from 'node:crypto';

export function verify(header, rawBody, secret) {
  const [t, v1] = header.split(',').map((part) => part.split('=')[1]);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return fresh && a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

> [!WARNING]
> Verify against the **raw request body**, exactly as received. Parsing and re-serialising the JSON changes the bytes and breaks the signature.

## Secrets

The signing secret is shown **once**, when you create the webhook. You cannot read it back, but you can **rotate** it at any time.

## Delivery and retries

Respond with a `2xx` status quickly. Anything else (including redirects, which are never followed) is retried with increasing delays (5 s, 10 s, 20 s, 40 s, 80 s) and then kept as a failed delivery. Requests time out after 10 seconds.

For safety, goShort only calls `https` addresses that resolve to public IP addresses. Private, loopback and cloud-metadata addresses are refused.

Delivery is best effort: if the queue is unavailable at the moment of a change, that event may not be sent.
