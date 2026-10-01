-- AlterEnum
ALTER TYPE "Dimension" ADD VALUE 'QR_CODE';

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "ClickEvent" ADD COLUMN     "qrCodeId" TEXT;

-- CreateTable
CREATE TABLE "AnalyticsBucket" (
    "bucket" TIMESTAMP(3) NOT NULL,
    "linkId" TEXT NOT NULL,
    "isBot" BOOLEAN NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsBucket_pkey" PRIMARY KEY ("bucket","linkId","isBot")
);

-- CreateIndex
CREATE INDEX "AnalyticsBucket_workspaceId_bucket_idx" ON "AnalyticsBucket"("workspaceId", "bucket");

-- CreateIndex
CREATE INDEX "AnalyticsBucket_campaignId_bucket_idx" ON "AnalyticsBucket"("campaignId", "bucket");
