---
title: API introduction
description: Everything you can do in the app, you can do over HTTP.
area: api
section: Overview
order: 1
slug: introduction
---

The goShort API is a JSON REST API. Use it to create and manage links, campaigns, QR codes and domains, and to read analytics from your own tools.

## Base URL

All endpoints live under `/api/v1` on your instance:

```text
https://app.example.com/api/v1
```

Replace `app.example.com` with your instance's address.

## A first request

Create an API key in the app under **API Keys**, then list your links:

```bash
curl https://app.example.com/api/v1/links?limit=5 \
  -H "Authorization: Bearer $GOSHORT_API_KEY"
```

## Conventions

- **Requests** with a body are JSON (`Content-Type: application/json`).
- **Successful responses** look like `{ "success": true, "data": … }`.
- **Errors** look like `{ "success": false, "error": { … }, "requestId": "…" }`. See [Errors](/docs/api/errors).
- **Lists** use cursors. See [Pagination](/docs/api/pagination).
- **Dates and times** are ISO 8601 in UTC. Analytics `from` and `to` are calendar dates (`YYYY-MM-DD`) in the timezone you request.
- **IDs** are opaque strings. Do not parse or generate them.

## Reference

The reference is organised by resource: [Links](/docs/api/links), Campaigns, QR codes, Domains and Analytics. Each operation shows its parameters, request body, responses and ready-to-copy examples.

> [!NOTE]
> The machine-readable OpenAPI 3.1 document is available at `/openapi.json` on your instance.
