---
title: QR codes
description: Design QR codes that scan, add a logo, download images and track scans.
area: guides
section: Guides
order: 5
---

A QR code encodes a short link, so scanning it counts as a click and appears in that link's analytics and in its campaign's.

## Design a QR code

Open **QR Codes** and choose **New QR code**. The preview on the right updates as you change settings.

| Setting                     | Range                                                                |
| --------------------------- | -------------------------------------------------------------------- |
| **Link**                    | Any link in the workspace. Cannot be changed later.                  |
| **Foreground / Background** | Hex colours such as `#000000`.                                       |
| **Size**                    | 128 to 2048 pixels.                                                  |
| **Margin**                  | 0 to 10 modules (default 2).                                         |
| **Error correction**        | L, M, Q or H. Higher survives more damage but makes a denser code.   |
| **Logo**                    | PNG or JPEG, up to 512 KB. Adding a logo sets error correction to H. |

## Codes that would not scan are blocked

goShort refuses combinations that scanners are likely to fail on:

- the foreground must be **darker** than the background (inverted codes are unreliable), and
- the contrast between the two must be at least **3:1**.

If your colours break a rule, the designer shows a warning and disables saving until you fix them.

## Download

Download as **SVG** (best for print) or **PNG**. The saved image is generated on demand, so changing a QR code's settings updates every future download.

## Tracking scans

Each QR code adds a hidden marker to its link (`?qr=<id>`). goShort uses it to count **QR scans** separately from other clicks on the same link, even if you also share that link elsewhere. The marker is not passed on to your destination.

## Security

Uploaded logos are re-encoded into a fresh image, so metadata and hidden content are removed. SVG logos are not accepted.
