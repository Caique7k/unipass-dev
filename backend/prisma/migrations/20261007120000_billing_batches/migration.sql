-- Lotes de emissão em massa (BillingBatch) e vínculo de cada cobrança ao lote.

-- CreateEnum
CREATE TYPE "BillingBatchStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'PARTIAL_FAILURE', 'FAILED');

-- AlterTable
ALTER TABLE "BillingCharge" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "BillingBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateId" TEXT,
    "referenceMonth" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "gateway" "BillingGatewayMode" NOT NULL,
    "status" "BillingBatchStatus" NOT NULL DEFAULT 'PROCESSING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "skippedDetails" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BillingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingBatch_companyId_createdAt_idx" ON "BillingBatch"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingCharge_batchId_status_idx" ON "BillingCharge"("batchId", "status");

-- AddForeignKey
ALTER TABLE "BillingCharge" ADD CONSTRAINT "BillingCharge_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BillingBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingBatch" ADD CONSTRAINT "BillingBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingBatch" ADD CONSTRAINT "BillingBatch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "BillingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingBatch" ADD CONSTRAINT "BillingBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

