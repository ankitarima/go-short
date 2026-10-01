# QR codes

QR codes are first-class campaign assets: **Campaign → Link → QR code → Analytics**. A QR code references a short link, so every scan is a click on that link and shows up in its analytics and in its campaign's.

## What is encoded

`https://<domain>/<slug>?qr=<qrId>`. The `?qr=` marker is read by the redirect service (when a query string exists), passed in the analytics event, and **validated by the worker**: it only counts if that QR exists and belongs to the clicked link. This gives true "QR scans" even when the same link is also shared in other ways. The marker is not forwarded to the destination.

## API (`/api/v1/workspaces/:id/qr`)

| Method | Path         | Notes                                                                                                                            |
| ------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/`          | Creates the record and returns the generated image plus metadata (`data` is SVG text, or base64 for PNG). Needs `qr:write`.      |
| GET    | `/`          | Cursor-paginated list; filters `campaignId`, `linkId`.                                                                           |
| GET    | `/:id`       | Metadata only.                                                                                                                   |
| GET    | `/:id/image` | Binary image. Query: `format=svg\|png`, `size=128..2048`, `download=1` (attachment).                                             |
| PATCH  | `/:id`       | Change name, campaign, colours, size, margin, correction, logo (`logoPath: null` removes it).                                    |
| DELETE | `/:id`       | Also deletes the logo file if no other QR uses it.                                                                               |
| POST   | `/logos`     | Upload a logo: raw body, `Content-Type: image/png` or `image/jpeg`, max 512 KB. Returns `{ logoPath }` to pass to create/update. |

Settings: `size` 128-2048 (default 512), `margin` 0-10 (default 2), `errorCorrection` L/M/Q/H (default M), `foregroundColor` / `backgroundColor` as `#RRGGBB`. Images are generated on demand and never stored in Postgres; deleting a link cascades to its QR codes.

## Scannability rules

A code that cannot be scanned is rejected instead of generated: foreground must be **darker** than the background (many scanners cannot read inverted codes) and the WCAG contrast ratio must be at least **3:1**. A logo forces error correction **H** and covers at most 22 % of the width (about 5 % of the area, well inside level H's ~30 % recovery). The test suite decodes generated PNGs (with and without logo) with a real QR reader to prove they scan back to the short URL.

## Security

- **No user SVG is ever used.** SVG output is built from the QR library's own markup plus numbers we compute, validated hex colours, and a base64 PNG data URI we produced. Colours are validated against a strict regex, so nothing can break out of an attribute.
- **Logo uploads** are identified by their **bytes** (PNG/JPEG signature), not the declared type; SVG/GIF/WebP are refused. Header dimensions are read **before** decoding (max 2048×2048) to defeat decompression bombs. The image is decoded, scaled to fit 256×256 and **re-encoded as a fresh PNG**, which drops EXIF, text chunks and trailing payloads.
- **Storage** goes through the `StorageProvider` interface (`LocalStorageProvider` under `STORAGE_PATH`, files `0600`). Keys are validated (no `..`, absolute paths, `//`, or characters outside a safe set) and resolved paths must stay inside the base directory. Add S3/MinIO/R2/Spaces adapters by implementing the interface. Keep `STORAGE_PATH` outside any web-served or executable path.
- A QR's logo path must live under that workspace's prefix; foreign, traversal or missing paths are `404`.
- Direct image responses carry `Content-Security-Policy: default-src 'none'; img-src data:; sandbox`, `no-store`, and `nosniff`.
- Feature flag `FEATURE_QR_LOGOS` disables uploads and logo use.
- Uploads are rate limited (30/hour per workspace); creation 60/min.

## Not included

Custom module shapes/gradients, a text label in the centre, and batch generation are not implemented.
