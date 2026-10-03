---
title: Team and roles
description: Invite teammates and decide what each role can do.
area: guides
section: Guides
order: 8
---

Open **Team** to see members and invite people by email.

## Roles

| Role       | Can                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| **Viewer** | Read links, campaigns, QR codes, domains, analytics and members.                                           |
| **Member** | Everything a viewer can, plus create, edit and delete links, campaigns and QR codes, and export analytics. |
| **Admin**  | Everything a member can, plus workspace settings, members, domains, API keys, webhooks and the audit log.  |
| **Owner**  | Everything an admin can, plus delete the workspace and grant the owner role.                               |

Nobody can grant a role higher than their own, and a workspace always keeps at least one owner.

## Invite someone

1. Choose **Invite** and enter their email and a role.
2. They receive an invitation link that is valid for 7 days.
3. Once they accept, they appear in the member list. You can change their role or remove them later.

> [!NOTE]
> Invitation emails require your instance to have an email provider configured. If you run your own instance, see [Self-hosting](/docs/self-hosting).

## Leaving and removing

Any member can **leave** a workspace. Removing a member also revokes the API keys they created, and demoting someone to viewer limits their keys to read-only.

## Audit log

Admins can review who did what under **Settings → Audit log**: sign-ins, member changes, domain and link changes, and API key creation. Secrets are never recorded.
