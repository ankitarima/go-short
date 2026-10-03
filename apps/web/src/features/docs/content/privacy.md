---
title: Privacy and data
description: What goShort stores about visitors, what it never stores, and your controls.
area: guides
section: Guides
order: 10
---

goShort is built to give you useful numbers while keeping as little personal data as possible.

## What is never stored

- **Raw IP addresses.** They are used briefly to work out the country and a daily hash, and are not written to the database.
- Full referrer URLs (only the host name is kept) and query strings.
- Precise location. Only country, region and city names are kept.

## What is stored

- Each click: time, link, country/region/city, device type, browser, operating system, referrer host, language, whether it looks like a bot, and any UTM values.
- A **daily hash** per visitor and per address, made with a secret that changes every day, so people cannot be followed across days. Hashing addresses can be turned off for the click record.

## Your controls (Settings → Privacy)

| Setting                               | Effect                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Hash IP addresses**                 | Stores the daily address hash on each click record. On by default.                                                    |
| **Hide bot traffic by default**       | Analytics hide bot clicks unless you include them. Bots are still stored.                                             |
| **Keep individual click records for** | Deletes click records older than the number of days you choose. Aggregated totals are kept. Empty means keep forever. |

## Exports

CSV exports never contain IP addresses or visitor hashes.

## Your responsibility

> [!NOTE]
> Operators are responsible for complying with the privacy laws that apply to them (consent notices, retention, data requests). goShort provides the controls above but does not make a deployment compliant by itself.
