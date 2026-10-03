-- CreateEnum
CREATE TYPE "SessionScope" AS ENUM ('APP', 'CONSOLE');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "scope" "SessionScope" NOT NULL DEFAULT 'APP';
