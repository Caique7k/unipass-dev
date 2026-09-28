#include <ESP8266WiFi.h>

const char* ssid = "Caique";
const char* password = "Cpma9803@";

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("==============================");
  Serial.println("       UNIPASS - UNIHUB");
  Serial.println("==============================");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Conectando ao Wi-Fi: ");
  Serial.println(ssid);

  int tentativas = 0;

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");

    tentativas++;

    if (tentativas >= 40) {
      Serial.println();
      Serial.println("Falha ao conectar no Wi-Fi.");
      return;
    }
  }

  Serial.println();
  Serial.println("Wi-Fi conectado!");

  Serial.print("IP do UniHub: ");
  Serial.println(WiFi.localIP());

  Serial.print("Sinal: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
}

void loop() {
}