# UniHub — firmware

Protótipo atual: **ESP8266 (NodeMCU)** + leitor **RC522**. Sem GPS, tela, 4G ou microSD ainda — o feedback é só pelo Serial (115200).

## Ligação do RC522

| RC522 | NodeMCU |
|---|---|
| SDA (SS) | D8 (GPIO15) |
| SCK | D5 |
| MOSI | D7 |
| MISO | D6 |
| RST | D0 (GPIO16) |
| 3.3V / GND | 3V3 / GND |

## Primeira gravação

1. Arduino IDE → Library Manager: instalar **MFRC522** e **ArduinoJson** (v7).
2. Placa: `NodeMCU 1.0 (ESP-12E Module)`, Flash Size com FS (o padrão `4MB (FS:2MB)` serve).
3. Copiar `unihub/secrets.example.h` para `unihub/secrets.h` e preencher Wi-Fi e `DEVICE_API_KEY` (igual ao `backend/.env`). `secrets.h` está no `.gitignore`.
4. Em `unihub/config.h`, `API_BASE_URL` deve ser o IP da máquina com a API na LAN (o ESP não enxerga `localhost`).
5. Abrir `unihub/unihub.ino` e gravar.

## Pareamento

1. Sem credenciais, o UniHub imprime **CODIGO DE PAREAMENTO: XXXXXX** (vale 10 min).
2. No painel, como ADMIN: **UniHub → Parear dispositivo**, digitar o código e escolher o ônibus.
3. Em até 5 s o UniHub recebe `code` + `secret`, salva na flash (`/cred.json`, LittleFS) e passa a operar.

Comandos no Serial: `status` e `reset` (apaga as credenciais e volta ao pareamento).

**Removido no painel** (tela UniHub → Remover): o servidor revoga as credenciais. Na próxima TAG lida o UniHub recebe 404, apaga `/cred.json` e volta sozinho ao pareamento — pode ser pareado de novo. Para já ver o código sem passar TAG, digite `reset` no Serial.

## Operação

Toda TAG lida vai para `POST /iot/rfid/read` com `{ code, secret, rfidTag }`. O backend decide:

| Resposta (`status`) | Quando |
|---|---|
| `CAPTURED` | O painel abriu "Ler TAG no UniHub" para este device (cadastro de aluno). Não gera embarque. |
| `AUTHORIZED` + `action: BOARDING` | Aluno não estava a bordo deste UniHub. |
| `AUTHORIZED` + `action: DEBOARDING` | Último evento do aluno neste UniHub foi um embarque. |
| `IGNORED` (`REPEATED_READ`) | Mesma TAG há menos de 5 s. |
| `DENIED` + `reason` | `UNKNOWN_TAG`, `INACTIVE_TAG`, `INACTIVE_STUDENT`, `OTHER_COMPANY`. Fica registrado como evento negado. |

Erros HTTP ficam só para infraestrutura: `401` API key, `404` credencial do device (o firmware volta ao pareamento), `400` device inativo/TAG malformada, `429` limite de requisições.

A TAG é enviada em hex maiúsculo sem separador (`04A1B2C3D4`), o mesmo formato salvo no banco.

## Segurança

- **Dev usa HTTP**: `x-api-key`, `code` e `secret` trafegam em claro na rede. Em produção a API precisa ser HTTPS e o firmware precisa usar `BearSSL::WiFiClientSecure` com certificado/fingerprint fixado — **ainda não implementado**.
- `DEVICE_API_KEY` é igual em todos os UniHubs e pode ser extraída da flash; ela é só uma primeira barreira. A identidade real de cada UniHub é o par `code` + `secret` individual gerado no pareamento.
- Se o UniHub perder a flash depois de pareado, o backend responde `alreadyPaired` e não há re-pareamento pelo painel hoje (ver CLAUDE.md, seção 12).
- Sem Wi-Fi, as leituras são descartadas (não há fila offline).
