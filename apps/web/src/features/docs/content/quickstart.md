---
title: Quickstart
description: Create a workspace, a short link and a QR code, then watch the clicks arrive.
area: guides
section: Getting started
order: 2
---

This takes about five minutes. You will need an account on a goShort instance.

## 1. Create your account and workspace

Sign up with your name, email and a password (12 or more characters). On first sign-in you are asked to **create your first workspace**. A workspace holds your links, campaigns, QR codes, domains and team.

## 2. Create a link

1. Open **Links** and choose **Create link**.
2. Paste the **Destination URL**. It must start with `http://` or `https://`.
3. Optionally set a **Custom slug** (for example `summer-sale`). Leave it empty for a random 7-character slug.
4. Save. Your short link is ready to copy.

Open it in a browser: you are redirected to the destination.

## 3. Add a QR code

1. Open **QR Codes** and choose **New QR code**.
2. Pick the link, a name, and your colours. The preview updates live.
3. Save, then download the image as SVG or PNG.

## 4. Group it in a campaign (optional)

Open **Campaigns**, choose **New campaign**, then pick that campaign when you create or edit links and QR codes.

## 5. Watch the results

Open **Analytics** (or the **Dashboard**) to see clicks, QR scans, countries, devices and referrers. Numbers appear within seconds of a click.

## Do the same with the API

```bash
curl -X POST https://app.example.com/api/v1/links \
  -H "Authorization: Bearer $GOSHORT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"destinationUrl":"https://example.com/sale","slug":"summer-sale"}'
```

Create the key under **API Keys** (admins and owners). See [Authentication](/docs/api/authentication) and the [Links reference](/docs/api/links).
