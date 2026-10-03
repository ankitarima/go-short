---
title: Pagination
description: Walk through long lists with cursors.
area: api
section: Overview
order: 4
---

List endpoints return one page at a time using **cursors**.

| Parameter | Meaning                                        |
| --------- | ---------------------------------------------- |
| `limit`   | Items per page, 1 to 100. Default 50.          |
| `cursor`  | The `nextCursor` value from the previous page. |

The response includes `nextCursor`. Pass it back as `cursor` to get the next page. When `nextCursor` is `null` you have reached the end.

```bash
# first page
curl "https://app.example.com/api/v1/links?limit=50" -H "Authorization: Bearer $KEY"
# next page
curl "https://app.example.com/api/v1/links?limit=50&cursor=eyJpZCI6Ii4uLiJ9" -H "Authorization: Bearer $KEY"
```

```javascript
async function allLinks() {
  const links = [];
  let cursor = null;
  do {
    const url = new URL('https://app.example.com/api/v1/links');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.GOSHORT_API_KEY}` },
    });
    const body = await res.json();
    links.push(...body.data);
    cursor = body.nextCursor;
  } while (cursor);
  return links;
}
```

> [!NOTE]
> Treat cursors as opaque. Do not build or edit them, and never assume a list is complete after one page.
