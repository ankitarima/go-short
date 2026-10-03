---
title: Introduction
description: What goShort is, what it can do, and where to start.
area: guides
section: Getting started
order: 1
---

goShort is an open-source, self-hosted platform for **short links, QR codes and campaign analytics**. You run it on your own server, so your links and your visitors' data stay with you.

## What you can do

- **Create short links** with random or custom slugs, an expiry date, a password, and UTM parameters.
- **Use your own domain** (for example `go.yourbrand.com`) after a quick DNS check.
- **Design QR codes** with your colours and logo. Combinations that would not scan are blocked before you print them.
- **Group everything into campaigns** and see links, QR codes and analytics in one place.
- **Measure** clicks, QR scans, countries, devices, referrers and more, in any timezone, and export the data as CSV.
- **Work as a team** with owners, admins, members and viewers.
- **Automate** with a REST API, API keys and signed webhooks.

## How the pieces fit

```text
Campaign ─► Link ─► QR code ─► Analytics
```

A QR code points at a short link, so every scan is also a click on that link. Links can belong to a campaign, and a campaign's analytics roll up all of its links and QR codes.

## Where to go next

- New here? Follow the [Quickstart](/docs/quickstart) to create your first link and QR code in a few minutes.
- Looking for a specific feature? Browse **Guides** in the sidebar.
- Building an integration? Open the [API reference](/docs/api).
- Running your own instance? See [Self-hosting](/docs/self-hosting).

> [!NOTE]
> goShort does not make a deployment compliant with privacy laws on its own. See [Privacy and data](/docs/privacy) for what is stored and what is not.
