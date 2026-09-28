-- "Excluir UniHub" passou a liberar o aparelho para novo pareamento em vez de
-- só marcar active=false. Devices desativados pela regra antiga ficavam presos
-- à empresa/ônibus e recusados até no pareamento; aplica a eles o mesmo estado
-- "de fábrica". TransportEvent mantém deviceId e companyId (histórico intacto).
UPDATE "RfidCaptureSession"
SET "cancelledAt" = NOW()
WHERE "tag" IS NULL
  AND "cancelledAt" IS NULL
  AND "deviceId" IN (SELECT "id" FROM "Device" WHERE "active" = false);

UPDATE "Device"
SET "companyId" = NULL,
    "busId" = NULL,
    "code" = NULL,
    "secret" = NULL,
    "name" = NULL,
    "pairedAt" = NULL,
    "pairingCode" = NULL,
    "pairingCodeExpiresAt" = NULL,
    "lastLat" = NULL,
    "lastLng" = NULL,
    "lastUpdate" = NULL,
    "active" = true
WHERE "active" = false;
