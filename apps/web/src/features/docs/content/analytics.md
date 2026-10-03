---
title: Analytics
description: Clicks, scans, locations and devices; filters, timezones, bots, exports and accuracy.
area: guides
section: Guides
order: 7
---

Open **Analytics** for the whole workspace, or the analytics tab of a link or campaign.

## What you see

- **Clicks**, split into **human clicks** and **bot clicks**
- **Unique visitors**
- **QR scans**
- A **timeline** (by day, or by hour for ranges up to 14 days)
- Breakdowns by **country, region and city**, **device**, **browser**, **operating system**, **referrer**, **UTM source / medium / campaign** and **QR code**
- **Top links** (workspace and campaign views)

## Filters

- **Date range** with presets such as 7 days or 30 days (up to 366 days).
- **Timezone**: timelines are exact in the timezone you choose, including half-hour zones such as India (+5:30) and Nepal (+5:45).
- **Include bots**: bot traffic is always stored, and this switch decides whether it is shown.
- **Link**, **country** and **device** filters. Country and device filters look at raw events, so they cover up to **31 days**.

## Export

Choose **Export** for CSV. You can export daily totals, or individual click records. Click exports never include IP addresses or visitor hashes, and are limited to 5 per minute. Members and above can export.

## How accurate is it?

> [!WARNING]
> Read this before you make decisions from a number.

- **Unique visitors are approximate.** They are counted from a hash of the visitor's address and browser, once per link per day. Over several days, the total is the sum of daily uniques, so a returning visitor counts once per day.
- **Bot detection is a heuristic** based on the browser's user agent.
- **Location is approximate**, especially city and region, and VPNs and mobile networks distort it.
- **Referrers are often missing**, particularly for QR scans and messaging apps.
- Totals and timelines are exact in your timezone. Other figures are grouped by UTC day, so they can differ slightly at the edges of a range in non-UTC timezones. The response explains this in its notes.

## Freshness

Clicks usually appear within a few seconds. If the analytics system is busy, they are queued and still counted.
