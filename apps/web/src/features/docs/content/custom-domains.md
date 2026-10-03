---
title: Custom domains
description: Use your own domain for short links, and how DNS verification works.
area: guides
section: Guides
order: 4
---

By default links use the platform's shared short domain. With a **custom domain** your links look like `go.yourbrand.com/sale`.

## Add a domain

1. Open **Domains** and choose **Add domain**.
2. Enter the hostname, for example `go.yourbrand.com`.
3. Add **one** of the DNS records shown, then choose **Verify DNS**.

| Record                  | Use it when                                             | Name                         | Value                                        |
| ----------------------- | ------------------------------------------------------- | ---------------------------- | -------------------------------------------- |
| **CNAME** (recommended) | A subdomain such as `go.yourbrand.com`                  | the hostname                 | the platform's short domain                  |
| **TXT**                 | An apex domain, or a CNAME that is proxied or flattened | `_goshort-verify.<hostname>` | the verification token shown for that domain |

Either record verifies the domain. DNS changes can take a while to spread; if verification fails, wait and try again. Verification is limited to 10 attempts per minute.

## After verification

Once a domain is **Verified**, create links on it as usual. HTTPS certificates are issued automatically the first time the domain is used (only for verified domains).

## Rules to know

- A hostname can belong to **one workspace** only.
- IP addresses, single-word names, `localhost` and names with ports are rejected.
- **Disabling** a domain stops all of its links; enabling it restores them. A domain with links cannot be deleted until its links are removed.
- A domain you started but never verified is released after 7 days.
- Verification is a one-time proof. If you later remove the DNS records, the domain stays verified until an admin disables it.

> [!NOTE]
> The shared platform domain is available to every workspace, so a slug that is taken there may belong to someone else. Use random slugs for anything sensitive.
