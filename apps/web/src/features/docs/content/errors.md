---
title: Errors
description: The error format, status codes and how to report problems.
area: api
section: Overview
order: 3
---

Failed requests return a non-2xx status and a JSON body:

```json
{
  "success": false,
  "error": {
    "code": "LINK_NOT_FOUND",
    "message": "Link not found",
    "details": []
  },
  "requestId": "req_7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

- `code` is stable and safe to branch on.
- `message` is for humans and may change.
- `details` (when present) lists field-level validation problems.
- `requestId` is also sent in the `X-Request-Id` header. **Include it when you contact support.**

## Status codes

| Status | Meaning                                                                 |
| ------ | ----------------------------------------------------------------------- |
| `400`  | The request is invalid. Check `details` for the fields.                 |
| `401`  | Not authenticated, or the API key is invalid, revoked or expired.       |
| `403`  | Not allowed: the key's access is too low, or a feature is disabled.     |
| `404`  | Not found. Also returned for things in workspaces you do not belong to. |
| `409`  | Conflict, for example a slug that is already taken.                     |
| `413`  | The request body is too large.                                          |
| `415`  | Unsupported media type.                                                 |
| `429`  | Rate limited. Wait for `Retry-After` seconds.                           |
| `5xx`  | Something went wrong on the server. Retry with backoff.                 |

Stack traces and internal details are never returned.
