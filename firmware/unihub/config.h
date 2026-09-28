#pragma once

// ---------------------------------------------------------------------------
// Configuração não sensível do UniHub (pode ir para o git).
// Wi-Fi e DEVICE_API_KEY ficam em secrets.h (fora do git).
// ---------------------------------------------------------------------------

// URL da API do UniPass, sem barra no final.
// Dev: IP da máquina na LAN (o ESP não enxerga "localhost").
// Produção: precisa ser HTTPS — ver "Segurança" no README.
#define API_BASE_URL "http://192.168.0.103:4000"

// RC522 no NodeMCU/Wemos (SPI: SCK=D5, MISO=D6, MOSI=D7)
#define RFID_SS_PIN 15   // D8
#define RFID_RST_PIN 16  // D0

// Tempos (ms)
#define HTTP_TIMEOUT_MS 5000         // tempo máximo de uma chamada à API
#define TAG_DEBOUNCE_MS 3000         // mesma TAG ignorada por esse tempo
#define PAIRING_POLL_MS 5000         // intervalo do claim durante o pareamento
#define WIFI_STATUS_LOG_MS 10000     // aviso no Serial enquanto estiver sem Wi-Fi
#define RFID_REINIT_MS 5000          // nova tentativa se o RC522 não responder
#define RFID_HEALTH_CHECK_MS 2000    // confere se o RC522 não resetou sozinho

#define CREDENTIALS_FILE "/cred.json"
