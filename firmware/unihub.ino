#include <SPI.h>
#include <MFRC522.h>

#define SS_PIN 15
#define RST_PIN 16

MFRC522 rfid(SS_PIN, RST_PIN);

bool tagPresente = false;

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("==============================");
  Serial.println("       UNIPASS - UNIHUB");
  Serial.println("==============================");

  SPI.begin();

  rfid.PCD_Init();
  delay(500);

  byte version = rfid.PCD_ReadRegister(rfid.VersionReg);

  Serial.print("Versao RC522: 0x");
  Serial.println(version, HEX);

  if (version == 0x00 || version == 0xFF) {
    Serial.println("ERRO: RC522 nao encontrado.");
    return;
  }

  Serial.println("RC522 conectado!");
  Serial.println("Aproxime uma TAG...");
  Serial.println();
}

void loop() {

  // Verifica se existe uma TAG no leitor
  if (!rfid.PICC_IsNewCardPresent()) {

    if (tagPresente) {
      tagPresente = false;

      Serial.println();
      Serial.println("TAG removida.");
      Serial.println("Aproxime uma TAG...");
      Serial.println();
    }

    delay(50);
    return;
  }

  // Impede leitura repetida enquanto a mesma TAG estiver parada
  if (tagPresente) {
    delay(50);
    return;
  }

  // Tenta ler UID
  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  tagPresente = true;

  Serial.println("------------------------------");
  Serial.println("TAG DETECTADA!");

  Serial.print("UID: ");

  for (byte i = 0; i < rfid.uid.size; i++) {

    if (rfid.uid.uidByte[i] < 0x10) {
      Serial.print("0");
    }

    Serial.print(rfid.uid.uidByte[i], HEX);

    if (i < rfid.uid.size - 1) {
      Serial.print(":");
    }
  }

  Serial.println();
  Serial.println("------------------------------");

  // Finaliza comunicacao com a TAG
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  delay(300);
}