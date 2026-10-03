---
title: Authentication
description: Authenticate with an API key, and what a key can and cannot do.
area: api
section: Overview
order: 2
---

Send your API key as a bearer token on every request:

```bash
curl https://app.example.com/api/v1/links \
  -H "Authorization: Bearer gs_AbCdEfGh_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

## Create a key

Workspace admins and owners create keys under **API Keys → Create API key**. Give the key a name, choose its access, and optionally an expiry date.

> [!WARNING]
> The full key is shown **once**, when you create it. Store it somewhere safe. If it leaks, revoke it immediately in the app.

## Access levels

| Access                    | Can                                                           |
| ------------------------- | ------------------------------------------------------------- |
| **Read-only** (viewer)    | Read links, campaigns, QR codes, domains and analytics.       |
| **Read & write** (member) | Also create, change and delete links, campaigns and QR codes. |

A key belongs to **one workspace**: the workspace is implied, so you do not pass a workspace id. It can never act as an admin or owner.

## What keys cannot do

Keys cannot manage API keys, members or webhooks, cannot read the audit log, and cannot call user-level endpoints (your profile, listing your workspaces, changing your password). Do those in the app.

## Errors you may see

| Status | Meaning                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| `401`  | The key is missing, malformed, unknown, revoked or expired.                                                 |
| `403`  | The key's access level does not allow this operation (for example a read-only key trying to create a link). |
| `429`  | Too many requests. See [Rate limits](/docs/api/rate-limits).                                                |

## Keep keys safe

- Never put a key in client-side code or a public repository.
- Use one key per integration so you can revoke them independently.
- Prefer read-only keys for dashboards and reporting.
