# KromaDrop

<sub>[English](README.md) · **Português**</sub>

Compartilhamento de arquivos no estilo AirDrop entre Windows, iPhone, Mac e
qualquer computador da mesma rede. O outro aparelho não precisa instalar nada:
é só escanear um QR code ou abrir um link. Nada passa pela internet.

![KromaDrop no Windows](docs/images/recent.png)

## Rodar

```bash
npm install
npm start
```

Gerar instalador (`.exe`, em `dist/`):

```bash
npm run dist
```

Na primeira vez, o Windows pergunta sobre o firewall: permita em **Redes privadas**.
A rede Wi-Fi precisa estar como **Privada** (Configurações → Rede e Internet).

## Como usar

- **iPhone → PC:** aponte a câmera para o QR code em *Conectar*, toque em
  "Escolher fotos ou arquivos". Os arquivos vão para a pasta definida em *Ajustes*.
- **PC → iPhone:** arraste arquivos para a janela (ou *Enviar ao iPhone →
  Adicionar arquivos*). Eles aparecem na hora em "Do PC" na página do iPhone;
  "Baixar" salva em Arquivos → Downloads.
- **Menu Compartilhar do iPhone:** siga o passo a passo do Atalho em *Conectar*.
- **Mac ou outro computador na mesma rede (Windows, Linux):** abra o endereço
  mostrado em *Conectar* em qualquer navegador e digite o código de acesso na
  primeira vez. Para mandar a este PC, arraste arquivos para a página; para
  receber, arraste na janela do KromaDrop e clique em *Baixar* no outro computador.

## Estrutura

- `src/main.js`: janela (acrílico do Windows 11), bandeja, notificações, IPC
- `src/server.js`: servidor HTTP (upload em stream, download com Range, eventos SSE)
- `src/store.js`: configurações, histórico e lista de envio (JSON em `%APPDATA%\KromaDrop`)
- `src/renderer/`: interface do PC
- `src/mobile/index.html`: página do iPhone/Mac
- `tools/make-icon.js`: gera os ícones; `tools/capture.js`: capturas de tela
  (`KD_CAPTURE=<pasta> npx electron .`)

## Segurança

Todo acesso exige o código de 8 caracteres (vai embutido no QR code). Gerar um
código novo em *Ajustes* desconecta todos os aparelhos.
