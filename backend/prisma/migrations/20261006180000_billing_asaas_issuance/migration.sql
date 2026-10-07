-- Emissão individual no Asaas: pagador com CPF/CNPJ cifrado, dados do boleto
-- na cobrança e trava de cobrança duplicada no banco.

-- AlterTable
ALTER TABLE "BillingCustomer" ADD COLUMN     "asaasSyncedAt" TIMESTAMP(3),
ADD COLUMN     "documentEncrypted" TEXT,
ADD COLUMN     "documentHash" TEXT,
ADD COLUMN     "documentMasked" TEXT;

-- AlterTable
ALTER TABLE "BillingCharge" ADD COLUMN     "barCode" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByUserId" TEXT,
ADD COLUMN     "gateway" "BillingGatewayMode" NOT NULL DEFAULT 'EXTERNAL',
ADD COLUMN     "gatewayAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gatewayError" TEXT,
ADD COLUMN     "gatewaySyncStartedAt" TIMESTAMP(3),
ADD COLUMN     "identificationField" TEXT,
ADD COLUMN     "issuedByUserId" TEXT,
ADD COLUMN     "nossoNumero" TEXT,
ADD COLUMN     "pixExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pixPayload" TEXT,
ADD COLUMN     "referenceMonth" TEXT;

-- CreateIndex
CREATE INDEX "BillingCustomer_companyId_documentHash_idx" ON "BillingCustomer"("companyId", "documentHash");

-- AddForeignKey
ALTER TABLE "BillingCharge" ADD CONSTRAINT "BillingCharge_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCharge" ADD CONSTRAINT "BillingCharge_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- O documento copiado em cada cobrança passa a ser só a versão mascarada
-- (o completo fica cifrado no BillingCustomer). Mesma máscara de
-- maskDocument() em billing-crypto.util.ts.
UPDATE "BillingCharge"
SET "recipientDocument" = CASE
  WHEN length(d) = 11 THEN '***.***.*' || substr(d, 8, 2) || '-' || substr(d, 10, 2)
  WHEN length(d) = 14 THEN '**.***.***/' || substr(d, 9, 4) || '-' || substr(d, 13, 2)
  WHEN length(d) > 0 THEN '***' || right(d, 2)
  ELSE NULL
END
FROM (
  SELECT id AS charge_id, regexp_replace("recipientDocument", '\D', '', 'g') AS d
  FROM "BillingCharge"
  WHERE "recipientDocument" IS NOT NULL AND position('*' IN "recipientDocument") = 0
) AS docs
WHERE "BillingCharge".id = docs.charge_id;

-- Uma cobrança ativa por aluno + grupo + mês de referência. Parcial: vale só
-- para cobranças com referenceMonth (as novas); as antigas ficam de fora e a
-- checagem por vencimento no código continua cobrindo-as. O Prisma não
-- declara índice parcial — não deixe um "migrate dev" futuro removê-lo.
CREATE UNIQUE INDEX "BillingCharge_active_student_template_month_key"
ON "BillingCharge"("companyId", "studentId", "templateId", "referenceMonth")
WHERE "status" <> 'CANCELLED'
  AND "referenceMonth" IS NOT NULL
  AND "studentId" IS NOT NULL
  AND "templateId" IS NOT NULL;
