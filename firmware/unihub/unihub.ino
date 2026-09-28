// ===========================================================================
// UniHub — firmware do leitor RFID do UniPass (ESP8266 + RC522)
//
// Fluxo:
//   1. Conecta no Wi-Fi (sem travar o loop; reconecta sozinho).
//   2. Sem credenciais salvas -> PAREAMENTO: pede um código ao backend,
//      mostra no Serial, e espera um ADMIN digitar esse código no painel
//      (UniHub -> Parear dispositivo). Recebe code+secret e salva na flash.
//   3. Pareado -> OPERAÇÃO: cada TAG lida vai para POST /iot/rfid/read.
//      O backend decide se é EMBARQUE, DESEMBARQUE ou cadastro de TAG
//      (quando o painel pediu "Ler TAG no UniHub").
//
// Bibliotecas (Library Manager): MFRC522 (GithubCommunity), ArduinoJson v7.
// Placa: "NodeMCU 1.0 (ESP-12E Module)" ou equivalente ESP8266.
//
// Comandos pelo Serial (115200): "status", "reset" (apaga credenciais e
// volta ao pareamento).
// ===========================================================================

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <LittleFS.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>

#include "config.h"
#include "secrets.h"

enum DeviceState { STATE_PAIRING, STATE_READY };

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

DeviceState state = STATE_PAIRING;
String hardwareId;
String deviceCode;
String deviceSecret;
String pairingCode;

bool rfidOk = false;
bool wifiWasConnected = false;
unsigned long lastRfidInitAttempt = 0;
unsigned long lastRfidHealthCheck = 0;
unsigned long lastWifiLog = 0;
unsigned long nextPairingStep = 0;

String lastTag;
unsigned long lastTagAt = 0;

// ---------------------------------------------------------------------------
// Feedback — hoje só Serial. Quando LED/buzzer/tela forem ligados, é aqui.
// ---------------------------------------------------------------------------
enum Feedback { FB_OK, FB_DENIED, FB_INFO, FB_ERROR };

void showResult(Feedback kind, const String& text) {
  const char* prefix = kind == FB_OK       ? "[ OK ]"
                       : kind == FB_DENIED ? "[NEGADO]"
                       : kind == FB_ERROR  ? "[ERRO]"
                                           : "[INFO]";
  Serial.print(prefix);
  Serial.print(' ');
  Serial.println(text);
}

// ---------------------------------------------------------------------------
// Credenciais na flash (LittleFS)
// ---------------------------------------------------------------------------
bool loadCredentials() {
  if (!LittleFS.exists(CREDENTIALS_FILE)) return false;

  File file = LittleFS.open(CREDENTIALS_FILE, "r");
  if (!file) return false;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, file);
  file.close();
  if (err) return false;

  deviceCode = doc["code"] | "";
  deviceSecret = doc["secret"] | "";
  return deviceCode.length() > 0 && deviceSecret.length() > 0;
}

bool saveCredentials(const String& code, const String& secret) {
  File file = LittleFS.open(CREDENTIALS_FILE, "w");
  if (!file) return false;

  JsonDocument doc;
  doc["code"] = code;
  doc["secret"] = secret;
  bool ok = serializeJson(doc, file) > 0;
  file.close();
  return ok;
}

void enterPairing(const char* reason) {
  LittleFS.remove(CREDENTIALS_FILE);
  deviceCode = "";
  deviceSecret = "";
  pairingCode = "";
  state = STATE_PAIRING;
  nextPairingStep = 0;
  showResult(FB_INFO, String("Modo pareamento: ") + reason);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
// Retorna o status HTTP (>0) ou -1 sem rede / falha de conexão.
int postJson(const char* path, JsonDocument& body, JsonDocument& response) {
  if (WiFi.status() != WL_CONNECTED) return -1;

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);

  if (!http.begin(client, String(API_BASE_URL) + path)) return -1;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", DEVICE_API_KEY);

  String payload;
  serializeJson(body, payload);
  int status = http.POST(payload);

  if (status > 0) {
    String raw = http.getString();
    response.clear();
    deserializeJson(response, raw);
  }

  http.end();
  return status;
}

// ---------------------------------------------------------------------------
// Wi-Fi
// ---------------------------------------------------------------------------
void setupWifi() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Conectando ao Wi-Fi: ");
  Serial.println(WIFI_SSID);
}

bool wifiReady() {
  bool connected = WiFi.status() == WL_CONNECTED;

  if (connected && !wifiWasConnected) {
    Serial.print("Wi-Fi conectado. IP: ");
    Serial.print(WiFi.localIP());
    Serial.print(" | Sinal: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  }

  if (!connected && millis() - lastWifiLog > WIFI_STATUS_LOG_MS) {
    lastWifiLog = millis();
    showResult(FB_ERROR, "Sem Wi-Fi — leituras de TAG nao serao registradas.");
  }

  wifiWasConnected = connected;
  return connected;
}

// ---------------------------------------------------------------------------
// RC522
// ---------------------------------------------------------------------------
void initRfid() {
  lastRfidInitAttempt = millis();
  rfid.PCD_Init();
  delay(50);
  byte version = rfid.PCD_ReadRegister(rfid.VersionReg);
  rfidOk = version != 0x00 && version != 0xFF;

  if (rfidOk) {
    Serial.print("RC522 conectado (versao 0x");
    Serial.print(version, HEX);
    Serial.println(").");
  } else {
    showResult(FB_ERROR, "RC522 nao encontrado. Confira a fiacao.");
  }
}

// O RC522 pode voltar ao estado de fábrica sozinho (queda de tensão quando o
// Wi-Fi transmite, mau contato). O chip continua respondendo no SPI, mas perde
// a configuração do PCD_Init e para de detectar TAG até um reset. TModeReg é
// um dos registradores que o PCD_Init grava (0x80); se mudou, o leitor resetou.
bool rfidConfigured() {
  byte version = rfid.PCD_ReadRegister(rfid.VersionReg);
  if (version == 0x00 || version == 0xFF) return false;
  return rfid.PCD_ReadRegister(rfid.TModeReg) == 0x80;
}

void checkRfidHealth() {
  if (millis() - lastRfidHealthCheck < RFID_HEALTH_CHECK_MS) return;
  lastRfidHealthCheck = millis();

  if (!rfidConfigured()) {
    showResult(FB_INFO, "RC522 perdeu a configuracao — reiniciando o leitor.");
    initRfid();
  }
}

// UID no formato canônico do backend: hex maiúsculo, sem separador.
String readTagUid() {
  String uid;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += '0';
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

// ---------------------------------------------------------------------------
// Pareamento
// ---------------------------------------------------------------------------
void pairingStep() {
  if (millis() < nextPairingStep) return;
  nextPairingStep = millis() + PAIRING_POLL_MS;

  JsonDocument body;
  JsonDocument res;
  body["hardwareId"] = hardwareId;

  if (pairingCode.length() == 0) {
    int status = postJson("/iot/devices/pairing/start", body, res);

    if (status < 0) {
      showResult(FB_ERROR, "API inacessivel. Confira API_BASE_URL em config.h.");
      return;
    }
    if (status == 401) {
      showResult(FB_ERROR, "API key recusada. Confira DEVICE_API_KEY em secrets.h.");
      return;
    }
    if (status >= 300) {
      showResult(FB_ERROR, String("pairing/start falhou (HTTP ") + status + "): " +
                               (res["message"] | ""));
      return;
    }

    if (res["alreadyPaired"] | false) {
      // O backend já entregou code+secret antes e este UniHub perdeu a flash.
      // Hoje não há re-pareamento pelo painel (CLAUDE.md, seção 12).
      showResult(FB_ERROR,
                 "Este UniHub ja foi pareado, mas perdeu as credenciais. "
                 "E preciso resetar o dispositivo no backend.");
      nextPairingStep = millis() + 60000;
      return;
    }

    pairingCode = res["pairingCode"] | "";
    Serial.println();
    Serial.println("==============================");
    Serial.print("  CODIGO DE PAREAMENTO: ");
    Serial.println(pairingCode);
    Serial.println("  Digite no painel: UniHub > Parear dispositivo");
    Serial.println("  (valido por 10 minutos)");
    Serial.println("==============================");
    return;
  }

  body["pairingCode"] = pairingCode;
  int status = postJson("/iot/devices/pairing/claim", body, res);

  if (status < 0) return;  // sem rede: tenta de novo no próximo ciclo

  if (status == 400 || status == 404) {
    showResult(FB_INFO, "Codigo expirado. Gerando outro...");
    pairingCode = "";
    nextPairingStep = 0;
    return;
  }

  if (status >= 300) {
    showResult(FB_ERROR, String("pairing/claim falhou (HTTP ") + status + ")");
    return;
  }

  if (!(res["credentialsReady"] | false)) return;  // admin ainda não vinculou

  String code = res["code"] | "";
  String secret = res["secret"] | "";

  if (code.length() == 0 || secret.length() == 0 || !saveCredentials(code, secret)) {
    showResult(FB_ERROR, "Falha ao salvar credenciais na flash.");
    return;
  }

  deviceCode = code;
  deviceSecret = secret;
  pairingCode = "";
  state = STATE_READY;
  showResult(FB_OK, String("Pareado como ") + deviceCode + " (" +
                        (res["name"] | "sem nome") + "). Aproxime uma TAG.");
}

// ---------------------------------------------------------------------------
// Operação
// ---------------------------------------------------------------------------
void handleTag(const String& tag) {
  Serial.println("------------------------------");
  Serial.print("TAG: ");
  Serial.println(tag);

  if (state != STATE_READY) {
    showResult(FB_INFO, "UniHub ainda nao pareado — leitura ignorada.");
    return;
  }

  JsonDocument body;
  JsonDocument res;
  body["code"] = deviceCode;
  body["secret"] = deviceSecret;
  body["rfidTag"] = tag;

  int status = postJson("/iot/rfid/read", body, res);

  if (status < 0) {
    showResult(FB_ERROR, "Sem conexao com a API — leitura nao registrada.");
    return;
  }
  if (status == 401) {
    showResult(FB_ERROR, "API key recusada. Confira DEVICE_API_KEY.");
    return;
  }
  if (status == 404) {
    // code/secret não existem mais no backend (device refeito/limpo).
    enterPairing("credenciais recusadas pelo servidor");
    return;
  }
  if (status == 429) {
    showResult(FB_ERROR, "Muitas leituras seguidas. Aguarde um instante.");
    return;
  }
  if (status >= 300) {
    showResult(FB_ERROR, String("HTTP ") + status + ": " + (res["message"] | ""));
    return;
  }

  String result = res["status"] | "";
  String studentName = res["student"]["name"] | "";

  if (result == "CAPTURED") {
    showResult(FB_OK, "TAG enviada ao painel para cadastro.");
  } else if (result == "AUTHORIZED") {
    String action = res["action"] | "";
    showResult(FB_OK, (action == "BOARDING" ? "EMBARQUE: " : "DESEMBARQUE: ") + studentName);
  } else if (result == "IGNORED") {
    showResult(FB_INFO, String("Leitura repetida (") + studentName + ").");
  } else if (result == "DENIED") {
    String reason = res["reason"] | "";
    // TAG desativada ou de aluno inativo = TAG livre: embarque negado, mas ela
    // pode ser vinculada a outro aluno pelo painel.
    String text = reason == "UNKNOWN_TAG"        ? "TAG nao cadastrada. Vincule no painel: Alunos > editar > Vincular TAG"
                  : reason == "INACTIVE_TAG"     ? "TAG livre (sem aluno ativo). Vincule no painel: Alunos > editar > Vincular TAG"
                  : reason == "INACTIVE_STUDENT" ? "TAG livre (aluno inativo). Vincule no painel: Alunos > editar > Vincular TAG"
                  : reason == "OTHER_COMPANY"    ? "TAG de outra empresa"
                                                 : reason;
    showResult(FB_DENIED, text);
  } else {
    showResult(FB_ERROR, "Resposta inesperada da API.");
  }
}

void pollRfid() {
  if (!rfidOk) {
    if (millis() - lastRfidInitAttempt > RFID_REINIT_MS) initRfid();
    return;
  }

  checkRfidHealth();

  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  String tag = readTagUid();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  // Aluno segurando o cartão no leitor gera várias leituras: só a primeira vale.
  if (tag == lastTag && millis() - lastTagAt < TAG_DEBOUNCE_MS) return;
  lastTag = tag;
  lastTagAt = millis();

  handleTag(tag);

  // A chamada HTTP acabou de usar o rádio (pico de consumo). Reaplica a
  // configuração do leitor para a próxima TAG não depender do health check.
  rfid.PCD_Init();
  lastRfidHealthCheck = millis();
  Serial.println("Pronto. Aproxime a proxima TAG.");
}

void handleSerialCommand() {
  if (!Serial.available()) return;

  String command = Serial.readStringUntil('\n');
  command.trim();
  command.toLowerCase();

  if (command == "reset") {
    enterPairing("reset pelo Serial");
  } else if (command == "status") {
    Serial.print("hardwareId: ");
    Serial.println(hardwareId);
    Serial.print("estado: ");
    Serial.println(state == STATE_READY ? "PAREADO" : "PAREAMENTO");
    Serial.print("code: ");
    Serial.println(deviceCode.length() ? deviceCode : "-");
    Serial.print("Wi-Fi: ");
    Serial.println(WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "desconectado");
    Serial.print("RC522: ");
    Serial.println(rfidOk ? "ok" : "nao encontrado");
  }
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("==============================");
  Serial.println("       UNIPASS - UNIHUB");
  Serial.println("==============================");

  hardwareId = "UNIHUB-" + String(ESP.getChipId(), HEX);
  hardwareId.toUpperCase();
  Serial.print("hardwareId: ");
  Serial.println(hardwareId);

  if (!LittleFS.begin()) {
    showResult(FB_ERROR, "LittleFS indisponivel — credenciais nao serao salvas.");
  }

  if (loadCredentials()) {
    state = STATE_READY;
    showResult(FB_OK, String("Credenciais carregadas: ") + deviceCode);
  } else {
    state = STATE_PAIRING;
    showResult(FB_INFO, "Sem credenciais — iniciando pareamento.");
  }

  SPI.begin();
  initRfid();
  setupWifi();
}

void loop() {
  handleSerialCommand();

  bool online = wifiReady();

  if (state == STATE_PAIRING && online) {
    pairingStep();
  }

  pollRfid();
  delay(20);
}
