# Fontes embutidas do MODO PALCO

Esta pasta vai **só para os apps** (Android, iPhone/iPad, Mac, Windows), copiada
como `stage_fonts/` ao lado do editor pelos mesmos scripts que levam a galeria
`stage_bg/`. Nunca vai para o `data/` (a LittleFS do pedal): o `webApp/build.mjs`
apaga uma `data/stage_fonts` que apareça.

O palco lê o `index.json` ao abrir. App sem a pasta mostra só as fontes do
sistema.

## Como entra uma fonte

1. Só fonte de **licença aberta** (SIL Open Font License ou equivalente).
2. Copie o `.woff2` e o **texto da licença** (`.txt`) para esta pasta.
3. Acrescente a entrada no `index.json`:

| Campo | O que é |
|---|---|
| `id` | letras, números, `-` e `_`, até 20. É o que fica gravado no perfil (`f:<id>`): não mude depois. |
| `file` | o `.woff2` desta pasta |
| `family` | nome interno da família (letras, números e espaço). Use um prefixo `BF` para não colidir com uma fonte instalada no aparelho. |
| `label` | o nome que aparece no cartão |
| `weight` | faixa de pesos de uma fonte variável (`"100 900"`); omita na fonte de peso único |
| `scope` | `all` = o palco inteiro · `name` = só os nomes e números grandes (fonte de display, ruim para texto miúdo) |
| `credit` | linha de autoria e licença, mostrada embaixo dos cartões |
| `license` | o `.txt` desta pasta com o texto da licença (o botão VER AS LICENÇAS o mostra) |

Fonte nova não precisa de código nem de build do editor: basta rodar de novo o
script que monta o app.
