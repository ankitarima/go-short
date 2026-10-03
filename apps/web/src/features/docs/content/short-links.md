---
title: Short links
description: Slugs, redirect types, UTM parameters, expiry, passwords and status.
area: guides
section: Guides
order: 3
---

A short link is a short URL on one of your domains that redirects to a destination.

## Create a link

Open **Links** and choose **Create link**. The fields:

| Field                   | What it does                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Destination URL**     | Where visitors are sent. Must be `http` or `https`, must not contain a username or password, and must not point back at a short-link domain. |
| **Domain**              | The shared platform domain, or one of your verified [custom domains](/docs/custom-domains).                                                  |
| **Custom slug**         | The path after the domain. Up to 64 characters. Leave empty for a random 7-character slug.                                                   |
| **Title / Description** | Notes for you and your team. Not shown to visitors.                                                                                          |
| **Campaign**            | Optionally group the link in a [campaign](/docs/campaigns).                                                                                  |
| **UTM parameters**      | Source, medium, campaign, term and content added to the destination.                                                                         |
| **Expires at**          | After this time the link stops redirecting.                                                                                                  |
| **Password**            | Visitors must enter it before they are redirected.                                                                                           |
| **Redirect type**       | `301`, `302`, `307` or `308`. The default is `302`.                                                                                          |

> [!TIP]
> Slugs are **case-sensitive**: `Sale` and `sale` are different links. Some words (such as `api`, `admin`, `login`) are reserved.

## Redirect types

- **302 / 307** are temporary. Browsers ask goShort every time, so every click is counted and you can change the destination freely. Use these unless you have a reason not to.
- **301 / 308** are permanent. Browsers may remember them and skip goShort on repeat visits, so **those repeat clicks are not counted**.

## UTM parameters

Values you set on the link are added to the destination URL when someone clicks. If the destination already contains a `utm_` value, **the destination's own value wins**, so nothing is duplicated. A [campaign](/docs/campaigns)'s default `utm_campaign` is used for links that do not set their own.

## Expiry, passwords and status

- A link can be **Active**, **Disabled** (turned off by you) or **Expired**. Disabled and expired links show a clear message to visitors instead of redirecting.
- **Password-protected** links show a small form. After 10 wrong attempts from one address within 15 minutes, further attempts are blocked for a while.
- Turning a link off, editing it, or deleting it takes effect immediately: cached copies are cleared.

## Limits

Link creation is limited to 120 per minute per workspace. Deleting a link also deletes its QR codes.
