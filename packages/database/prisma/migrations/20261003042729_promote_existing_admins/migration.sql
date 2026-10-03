-- Before platform roles existed, ADMIN could do everything, including granting ADMIN to others.
-- That is exactly SUPER_ADMIN today, so existing admins keep their full powers. (Separate from the
-- migration that adds the enum values: PostgreSQL cannot use a new enum value in the same transaction.)
UPDATE "User" SET "systemRole" = 'SUPER_ADMIN' WHERE "systemRole" = 'ADMIN';
