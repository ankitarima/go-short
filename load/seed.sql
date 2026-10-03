-- Load-test fixture: one workspace, 100 campaigns, N links on the shared domain, one API key.
-- Run through load/seed.sh (it passes the variables). Safe to re-run: it replaces its own data.
--
-- Link mix, by index i (slug 'k' || zero-padded i): every 100th is DISABLED, every 200th+1 is EXPIRED,
-- ~30% carry UTM parameters, links are spread over 100 campaigns. load/redirect.js knows these rules
-- and asserts the exact status (302 / 410) for every request it makes.
\set ON_ERROR_STOP on
BEGIN;

DELETE FROM "Workspace" WHERE slug = 'loadtest';
DELETE FROM "User" WHERE email = 'loadtest@example.com';

INSERT INTO "User" (id, email, name, "passwordHash", "updatedAt")
VALUES ('lt_user', 'loadtest@example.com', 'Load Test', 'x-not-a-real-hash', now());
INSERT INTO "Workspace" (id, name, slug, "updatedAt") VALUES ('lt_ws', 'Load Test', 'loadtest', now());
INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", role)
VALUES ('lt_member', 'lt_ws', 'lt_user', 'OWNER');

INSERT INTO "Campaign" (id, "workspaceId", name, "updatedAt")
SELECT 'lt_c' || lpad(c::text, 3, '0'), 'lt_ws', 'Load campaign ' || c, now() FROM generate_series(1, 100) c;

INSERT INTO "Link" (id, "workspaceId", "domainId", "campaignId", slug, "destinationUrl", "isActive",
                    "expiresAt", "utmSource", "utmMedium", "utmCampaign", "updatedAt")
SELECT 'lt_l' || lpad(i::text, 7, '0'),
       'lt_ws',
       (SELECT id FROM "Domain" WHERE "isDefault" LIMIT 1),
       'lt_c' || lpad((i % 100 + 1)::text, 3, '0'),
       'k' || lpad(i::text, 6, '0'),
       'https://example.org/landing/' || i || '?ref=load',
       (i % 100 <> 0),
       CASE WHEN i % 200 = 1 THEN now() - interval '1 day'
            WHEN i % 10 = 5 THEN now() + interval '30 days' END,
       CASE WHEN i % 10 < 3 THEN 'loadtest' END,
       CASE WHEN i % 10 < 3 THEN 'bench' END,
       CASE WHEN i % 10 < 3 THEN 'campaign-' || (i % 100) END,
       now()
FROM generate_series(1, :links) i;

INSERT INTO "ApiKey" (id, "workspaceId", "createdById", name, "keyPrefix", "keyHash", role)
VALUES ('lt_key', 'lt_ws', 'lt_user', 'load test', left(:'apikey', 11),
        encode(sha256(convert_to(:'apikey', 'UTF8')), 'hex'), 'MEMBER');

COMMIT;
ANALYZE "Link";
SELECT count(*) AS links FROM "Link" WHERE "workspaceId" = 'lt_ws';
