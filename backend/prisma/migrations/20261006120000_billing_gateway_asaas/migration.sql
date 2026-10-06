-- Gateway de cobrança por empresa: "EXTERNAL" (processo próprio) ou "ASAAS"
-- (a conta Asaas da própria empresa, com a chave guardada cifrada).
--
-- O antigo PLATFORM_GATEWAY era um onboarding que nunca chegava a ACTIVE
-- (não existe aprovação) e nenhuma dessas empresas tem chave Asaas salva.
-- Elas voltam para EXTERNAL para continuar emitindo pelo fluxo local de
-- sempre; quem quiser o Asaas ativa de novo pela tela "Gateway de cobrança".
-- As colunas do onboarding antigo ficam (nenhum dado é apagado).
UPDATE "CompanyBillingSettings"
SET "gatewayMode" = 'EXTERNAL'
WHERE "gatewayMode" = 'PLATFORM_GATEWAY';

-- CreateEnum
CREATE TYPE "AsaasConnectionCheck" AS ENUM ('UNTESTED', 'VALIDATED', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingAuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- AlterEnum
CREATE TYPE "BillingGatewayMode_new" AS ENUM ('EXTERNAL', 'ASAAS');
ALTER TABLE "CompanyBillingSettings" ALTER COLUMN "gatewayMode" DROP DEFAULT;
ALTER TABLE "CompanyBillingSettings" ALTER COLUMN "gatewayMode" TYPE "BillingGatewayMode_new" USING ("gatewayMode"::text::"BillingGatewayMode_new");
ALTER TYPE "BillingGatewayMode" RENAME TO "BillingGatewayMode_old";
ALTER TYPE "BillingGatewayMode_new" RENAME TO "BillingGatewayMode";
DROP TYPE "BillingGatewayMode_old";
ALTER TABLE "CompanyBillingSettings" ALTER COLUMN "gatewayMode" SET DEFAULT 'EXTERNAL';

-- AlterEnum (estorno deixa de ser tratado como cancelamento)
ALTER TYPE "BillingChargeStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "CompanyBillingSettings" ADD COLUMN     "asaasAccountDocumentMasked" TEXT,
ADD COLUMN     "asaasAccountName" TEXT,
ADD COLUMN     "asaasApiKeyEncrypted" TEXT,
ADD COLUMN     "asaasApiKeyLast4" TEXT,
ADD COLUMN     "asaasConnectionCheck" "AsaasConnectionCheck" NOT NULL DEFAULT 'UNTESTED',
ADD COLUMN     "asaasConnectionCheckedAt" TIMESTAMP(3),
ADD COLUMN     "asaasConnectionError" TEXT,
ADD COLUMN     "asaasEnvironment" TEXT,
ADD COLUMN     "asaasWebhookConfiguredAt" TIMESTAMP(3),
ADD COLUMN     "asaasWebhookEndpointKey" TEXT,
ADD COLUMN     "asaasWebhookId" TEXT,
ADD COLUMN     "asaasWebhookTokenHash" TEXT;

-- AlterTable (trilha de auditoria financeira)
ALTER TABLE "BillingEventLog" ADD COLUMN     "actorUserId" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "outcome" "BillingAuditOutcome";

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBillingSettings_asaasWebhookEndpointKey_key" ON "CompanyBillingSettings"("asaasWebhookEndpointKey");

-- CreateIndex
CREATE INDEX "BillingEventLog_companyId_eventType_createdAt_idx" ON "BillingEventLog"("companyId", "eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "BillingEventLog" ADD CONSTRAINT "BillingEventLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
