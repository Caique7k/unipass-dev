-- CreateTable
CREATE TABLE "RfidCaptureSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "tag" TEXT,
    "capturedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RfidCaptureSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RfidCaptureSession_deviceId_expiresAt_idx" ON "RfidCaptureSession"("deviceId", "expiresAt");

-- CreateIndex
CREATE INDEX "RfidCaptureSession_companyId_idx" ON "RfidCaptureSession"("companyId");

-- AddForeignKey
ALTER TABLE "RfidCaptureSession" ADD CONSTRAINT "RfidCaptureSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfidCaptureSession" ADD CONSTRAINT "RfidCaptureSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfidCaptureSession" ADD CONSTRAINT "RfidCaptureSession_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
