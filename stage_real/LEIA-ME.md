# stage_real/ · imagens do MODO REALISTA do palco

Esta pasta guarda as imagens do segundo modo visual do palco (REALISTA): os
knobs, as chaves liga/desliga e os blocos da cadeia deixam de ser desenho e
viram imagem, sobre **painéis de metal** com parafusos nos cantos. O modo
realista tem dois estilos, **MODERN** e **CLASSIC**, e cada estilo traz dois
knobs, o **redondo** e o **chicken head**. O plano e as
decisões estão em `PLANO_MODO_REALISTA.md`, na raiz do projeto.

Existem duas cópias desta pasta, uma por produto, sempre iguais:

- `BF_VIEW/public/stage_real/` — o app BF VIEW
- `production/stage_real/` — o MODO PALCO dos apps da BFMIDI

**Não edite esta pasta à mão.** Ela é gerada por `tools/build_stage_real.py` a
partir dos PNG originais, que ficam em `icons/source_stage_real/MODERN/` e
`icons/source_stage_real/CLASSIC/`. O script grava as duas cópias e o
`index.json`.

Sem o `index.json` o modo realista não aparece no app. Estilo sem imagens fica
inerte na escolha, e imagem que faltar dentro de um estilo cai no desenho
daquela peça.

## Trocar ou acrescentar uma imagem

1. Ponha o PNG na pasta do estilo, em `icons/source_stage_real/`, com o nome da
   tabela abaixo.
2. Rode `python3 tools/build_stage_real.py` (no Windows, `py tools\build_stage_real.py`).
   Leva cerca de um minuto.
3. Os apps só pegam as imagens novas quando forem reconstruídos.

| Arquivo de origem | O que é | Tamanho |
|---|---|---|
| `knob_cap.png` | knob redondo, a parte que gira, marca para cima | 512 × 512 |
| `knob_chicken_head.png` | knob chicken head, marca para cima | 512 × 512 |
| `knob_base.png` | escala (anel com os traços), fica parada atrás | 512 × 512 |
| `switch_on.png`, `switch_off.png` | chave ligada e desligada, mesmo enquadramento | 512 × 512 |
| `block_<nome>.png` | bloco da cadeia | 384 × 512 |
| `panel_knobs.png` | textura atrás dos knobs e das chaves | 1024 × 1024 |
| `panel_chain.png` | textura atrás dos blocos | 1024 × 1024 |
| `panel_head.png` | textura atrás do nome do preset | 1024 × 1024 |
| `screw.png` | parafuso dos cantos do painel, fundo transparente | 256 × 256 |
| `panel_plate.png` + `panel_plate_v.png` | PLACA COM MOLDURA (no lugar dos três `panel_*` e do parafuso); feitas pelo `prep_stage_real.py` | a que o prep gravar |

As regras para criar as texturas (repetir sem emenda, luz uniforme, tom) estão em
`INSTRUCOES_PAINEIS_REALISTAS.md`, na raiz do projeto.

Bloco novo: além do arquivo, acrescente uma linha na tabela `BLOCKS` do script
(bloco do palco → nome do arquivo).

## Knobs e chaves (refeitos em 12/out/2026)

O dono refez os knobs e as chaves dos DOIS estilos. As imagens novas chegaram
com transparência de verdade, então seguem um caminho mais curto que o do
pacote original:

1. As imagens como vieram ficam em `icons/source_stage_real/<ESTILO>/brutos/`
   (`knob_base`, `knob_cap`, `knob_chicken_head`, `switch_on`, `switch_off`, em
   `.webp` ou `.png`).
2. `tools/prep_stage_real.py` acerta o enquadramento e grava os PNG de 512 px
   na pasta do estilo, mais o `ajustes.json`:
   - `py tools/prep_stage_real.py MODERN --round 0.68 --chicken 0.71`
   - `py tools/prep_stage_real.py CLASSIC --round 0.59 --chicken 0.74 --no-rotate --plate 96`
   - o que não for passado continua como estava no `ajustes.json` (rodar só
     `py tools/prep_stage_real.py CLASSIC` refaz tudo com os mesmos números)
3. `py tools/build_stage_real.py --style MODERN` (ou `CLASSIC`) gera o pacote
   só desse estilo; o outro fica como está.

O que o passo 2 acerta:

- **Escala:** centrada. Se ela tem um FURO de verdade no meio (CLASSIC), o
  centro usado é o do furo, porque é dentro dele que o knob gira.
- **Knob redondo:** girado até a marca apontar para cima (o do MODERN veio a
  44°). Com `--no-rotate` fica como veio: é o caso do CLASSIC, que já veio com
  a marca para cima e tem a marca escura, que a busca não acha.
- **Chicken head:** deslocado para o eixo (o centro do disco de baixo) cair no
  centro da imagem. A ponta é mais comprida que a asa.
- **Chaves:** o prato das duas no mesmo tamanho e no mesmo lugar, para a troca
  não pular. No CLASSIC, `switch_on` é a alavanca para cima (lado do "ON").

O `ajustes.json` (`"clean": true`) avisa o gerador de que essas imagens não
passam pela limpeza descrita mais abaixo (achar contorno, furo na escala,
recorte do chicken head em disco). Ele também guarda o tamanho de cada knob
dentro da escala. Para mudar o tamanho, edite os dois números e rode o passo 3.

| Estilo | `round_scale` | `chicken_scale` | De onde saiu |
|---|---|---|---|
| MODERN | 0,68 | 0,71 | o knob cobre o miolo da escala até o aro; a ponta do chicken head chega na borda de dentro dos traços |
| CLASSIC | 0,59 | 0,74 | o knob cobre o furo e encosta no aro dourado (o furo tem 0,57 do raio); a ponta do chicken head entra no começo dos traços |

A escala do MODERN tem um miolo próprio, que fica escondido atrás do knob. A do
CLASSIC é um anel vazado: o que aparece pelo furo é o knob.

## Painel do CLASSIC: placa com moldura (12/out/2026)

O dono mandou uma placa de latão envelhecido, inteira, com a moldura dela e os
cantos transparentes. Ela não é um ladrilho: não dá pra repetir. Então o
CLASSIC usa outro jeito de desenhar o painel, e o MODERN continua com os
ladrilhos e os parafusos.

- A imagem como veio fica em `icons/source_stage_real/CLASSIC/brutos/panel_plate.webp`.
- `prep_stage_real.py` a recorta pelo contorno, reduz para 1400 px de largura
  (`panel_plate.png`) e grava também uma cópia EM PÉ, de 1000 px
  (`panel_plate_v.png`). No `ajustes.json` fica o campo `plate`.
- Com a placa na pasta, o gerador usa essa imagem nas TRÊS zonas (knobs, blocos
  e nome do preset) e deixa de fora do pacote os três ladrilhos e o parafuso do
  estilo. Os arquivos `panel_knobs/chain/head.png` e `screw.png` do CLASSIC
  continuam na pasta de origem, sem uso: apagar `panel_plate.png` e
  `panel_plate_v.png` (e o campo `plate`) devolve o painel antigo.
- No app a placa é cortada em nove pedaços: os quatro cantos ficam do tamanho
  certo, as bordas esticam num sentido só e o miolo estica nos dois. O pedaço
  que não estica (`cut`) tem 96 px da imagem original, o bastante pra moldura e
  pra curva de dentro do canto. Pra mudar: `--plate N` no prep.
- A cópia em pé serve à cadeia lateral, que é estreita e alta. Com a placa
  deitada o miolo esticaria vinte vezes num sentido só.
- A placa é clara o bastante pra pedir texto escuro (`ink: dark`), como o
  painel creme de antes.
- **Limite conhecido:** nas zonas altas (área dos knobs na cadeia lateral e nos
  Favoritos) o miolo estica mais na vertical, e as manchas de ferrugem ficam
  alongadas. Uma segunda placa mais alta (perto de 2 por 1) resolveria.

## Quais blocos têm imagem

**Hoje nenhuma destas imagens aparece na tela.** Desde 12/out/2026 os blocos da
cadeia usam os ícones desenhados do modo normal, sem moldura (decisão do dono).
Os arquivos continuam no pacote e a tabela abaixo vale se as fotos voltarem
(`REAL_BLOCK_IMAGES` no `stagemode.jsx` dos dois palcos).

| Bloco do palco | Imagem usada |
|---|---|
| `gate` (noise gate) e `ns` (redutor de ruído da GP-5) | `block_gate` |
| `pre` (pré-efeito da GP-5) | `block_boost` |
| `dist` (drive, overdrive, distorção) | `block_dist` |
| `comp` | `block_comp` |
| `eq` | `block_eq` |
| `mod` (chorus, phaser, tremolo...) | `block_mod` |
| `dly` | `block_delay` |
| `rvb` | `block_reverb` |
| `wah` | `block_wah` |
| `vol` | `block_vol` |
| Kemper: booster, entrada, loop | `block_boost`, `block_input`, `block_loop` |

**Sem imagem no pacote** (continuam desenhados): `amp` (amplificador), `cab`
(caixa / IR), `cap` (captura da Nano Cortex), `pitch` e `filter`. Para entrarem,
basta criar `block_amp.png`, `block_cab.png` e assim por diante, e acrescentar a
linha na tabela `BLOCKS`.

Vieram no pacote e não são usadas: `block_drive`, `block_od`, `block_fuzz`,
`block_tuner` e `block_generic` (o palco tem um bloco só para distorção, e a
imagem com "?" não entra no lugar de um bloco conhecido).

## O que o script faz com os originais

Os PNG do pacote original vieram com a grade de transparência **pintada** em
volta do objeto (falsa transparência), então não dá para usá-los direto. Para
knobs, escala e chaves, o que segue só vale num estilo SEM `ajustes.json`
(hoje nenhum: os dois foram refeitos). Para blocos, painéis e parafuso, vale
sempre:

- **Knob redondo e chaves:** o contorno do objeto é achado e a grade em volta
  vira transparência de verdade.
- **Escala:** o mesmo por fora, e o miolo vira um furo redondo (o knob aparece
  por ele).
- **Chicken head:** veio recortado em oval, com a ponta e a base do ponteiro
  cortadas. Vira um disco do tamanho do knob redondo, com a borda escurecida.
- **Blocos:** só a borda esfumada é apertada. A faixa texturizada em volta do
  pedal faz parte do original e fica.
- **`knob_top.png` não é usado:** veio opaco, com a grade pintada no vidro. Para
  ter o reflexo, a imagem precisa ser exportada de novo com transparência de
  verdade.
- **Painéis:** a textura é um ladrilho que se repete. Se a borda direita não
  continua na esquerda (ou a de baixo na de cima), o script desfaz a emenda
  fundindo as bordas (foi o caso de `panel_knobs` e `panel_head` do MODERN). A
  claridade média decide a cor do texto que vai por cima: o CLASSIC é creme,
  então os textos sobre ele ficam escuros. Saem em 512 px.
- **Parafuso:** veio com transparência de verdade. Sai em 96 px.

Depois as margens vazias são cortadas e tudo é convertido para WebP (pelo
`cwebp` ou, sem ele, pelo PIL; sem nenhum dos dois o script grava PNG). O
pacote inteiro tem cerca de 1 MB: os knobs e as chaves novos são maiores que
os antigos, porque guardam a transparência das bordas, e a placa do CLASSIC
(deitada e em pé) pesa 227 KB.

Para imagens novas, o ideal é exportar já com fundo transparente de verdade e o
objeto inteiro dentro do quadro. As regras estão em
`INSTRUCOES_PAINEIS_REALISTAS.md`, na raiz do projeto (seção 6).

## Formato do index.json

```json
{
  "v": 1,
  "sets": {
    "modern": {
      "knobs": {
        "round":   { "cap": "modern/knob-cap.webp", "base": "modern/knob-base.webp", "scale": 0.74 },
        "chicken": { "cap": "modern/knob-chicken.webp", "base": "modern/knob-base.webp" }
      },
      "switch": { "on": "modern/switch-on.webp", "off": "modern/switch-off.webp" },
      "blocks": { "gate": "modern/blk/gate.webp", "dly": "modern/blk/delay.webp" },
      "panels": {
        "knobs": { "src": "modern/panel-knobs.webp", "ink": "light" },
        "chain": { "src": "modern/panel-chain.webp", "ink": "light" },
        "head":  { "src": "modern/panel-head.webp",  "ink": "light" },
        "screw": "modern/screw.webp"
      }
    },
    "classic": { "knobs": {}, "switch": {}, "blocks": {}, "panels": {} }
  }
}
```

- Estilos: `modern` e `classic`. Knobs: `round` e `chicken`. O app só conhece
  esses nomes.
- `cap` = a imagem que gira. `base` (atrás) e `top` (na frente) ficam paradas e
  são opcionais.
- `scale` = tamanho do `cap` em relação à `base` (o knob redondo fica dentro da
  escala). Padrão: 1.
- `min` e `max` (em graus) mudam o curso do knob. Padrão: -135 e 135.
- `blocks`: a chave é o nome do bloco no palco (tabela acima); `default` vale
  para qualquer bloco sem imagem própria; `k-<categoria>` vale só para o Kemper.
- `panels`: `knobs` (atrás dos knobs), `chain` (atrás dos blocos) e `head`
  (atrás do nome do preset), cada um com `src` e `ink`: `light` = painel escuro,
  texto claro; `dark` = painel claro, texto escuro. `screw` é opcional. Cada
  painel é opcional: o que faltar fica com o fundo desenhado.
- PLACA COM MOLDURA: a zona que tiver `cut` não é ladrilho, é uma chapa inteira
  esticada em nove pedaços. `cut` = quanto de cada canto da imagem é moldura,
  em px da imagem gravada; `round` = raio do canto ÷ `cut` (pra sombra
  acompanhar a curva); `srcV` e `cutV` = a cópia em pé, usada na cadeia
  lateral. Exemplo: `{ "src": "classic/panel-plate.webp", "ink": "dark",
  "cut": 69.8, "round": 0.44, "srcV": "classic/panel-plate-v.webp", "cutV": 49.8 }`.
  Zona com placa não leva parafuso.
- Os arquivos ficam dentro desta pasta. Nada de endereço de fora.
- O formato antigo, com um `knob` só no lugar de `knobs`, continua aceito (vale
  como `round`).
