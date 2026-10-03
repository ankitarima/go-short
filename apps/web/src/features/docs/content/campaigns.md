---
title: Campaigns
description: Group links and QR codes and see their results together.
area: guides
section: Guides
order: 6
---

A campaign groups links and QR codes that belong together, such as a festival promotion, and rolls up their analytics into one view.

## Create a campaign

Open **Campaigns** and choose **New campaign**.

| Field                     | Notes                                                    |
| ------------------------- | -------------------------------------------------------- |
| **Name**                  | Required.                                                |
| **Description**           | Optional.                                                |
| **Start date / End date** | Optional. The end date cannot be before the start date.  |
| **Default utm_campaign**  | Used by links in the campaign that do not set their own. |

A campaign shows as **Scheduled**, **Active** or **Ended** based on its dates.

## Add links and QR codes

Choose the campaign when you create or edit a link or a QR code. QR codes inherit their link's campaign unless you pick another.

## One example, three channels

Give each link its own source and medium and share one campaign name:

| Channel   | utm_source  | utm_medium | utm_campaign |
| --------- | ----------- | ---------- | ------------ |
| Instagram | `instagram` | `social`   | `diwali2026` |
| Facebook  | `facebook`  | `social`   | `diwali2026` |
| Poster QR | `offline`   | `qr`       | `diwali2026` |

The campaign page then shows clicks per source, QR scans, top links, countries, devices and referrers.

## Good to know

- **Deleting a campaign keeps its links and QR codes.** They simply no longer belong to a campaign.
- Daily totals follow a link's **current** campaign, so moving a link mid-day moves that day's rollup with it.
- Campaigns show facts only. They are never ranked "best" or "worst".
