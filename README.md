# Reserva de Notebooks — SENAI Santa Catarina

Sistema web de reserva de notebooks para a unidade Videira do SENAI SC. Permite que professores reservem notebooks com controle de disponibilidade em tempo real, armazenando os dados diretamente em uma planilha Google Sheets via Google Apps Script.

---

## Unidades atendidas

| Unidade | Carrinho | Notebooks disponíveis |
|---|---|---|
| Videira | Carrinho 1 | 35 |
| Videira | Carrinho 2 | 35 |

---

## Funcionalidades

### Reservar
- Formulário com validação em tempo real dos campos obrigatórios
- Seleção do carrinho (Carrinho 1 ou Carrinho 2) e quantidade de notebooks
- Seleção de períodos livres com data e horário de retirada e devolução (sem restrição de turno fixo)
- Múltiplos períodos por reserva
- **Reserva recorrente**: gera vários períodos de uma vez escolhendo data início, data fim, dias da semana e horário — em vez de adicionar período por período manualmente (limite de 60 períodos por geração)
- Verificação de disponibilidade antes de salvar — exibe notebooks restantes ao vivo
- Quando o período está lotado, sugere automaticamente as próximas datas disponíveis com o mesmo horário
- Confirmação visual após reserva bem-sucedida

### Disponibilidade Agora
- Cards dos 2 carrinhos na primeira página, sempre visíveis
- Mostra notebooks em uso no momento e reservas do dia que ainda não iniciaram
- Barra de uso visual com percentual
- Atualização automática a cada 60 segundos
- Exibe aviso quando a conexão com a planilha falha

### Consultar
- Calendário mensal com disponibilidade por dia para cada carrinho
- Filtro por horário de retirada e devolução para consulta de janela específica
- Visão individual (detalhada, com horários reservados) ou comparativa entre os carrinhos
- Legenda de disponibilidade (Alta / Média / Baixa / Esgotado)

### Exportar (área restrita)
- Protegida por senha, **validada também no servidor** (Code.gs) a cada cancelamento/edição de reserva — a tela só esconde a área, mas quem cancela ou edita precisa enviar a senha correta em toda chamada
- Filtros por carrinho e intervalo de datas
- Exporta CSV com BOM (compatível com Excel)
- Gerenciar Reservas: buscar, editar e **cancelar** reservas de qualquer pessoa (exige senha de administrador)

### Privacidade (LGPD)
- Nomes mascarados em todas as exibições públicas (ex.: `Vi*** L****`)
- CPFs mascarados (ex.: `123.***.**-45`)
- Dados completos disponíveis apenas na exportação protegida por senha

---

## Estrutura do projeto
```
Reserva_Notebooks/
├── index.html      # Interface completa (formulário, consulta, exportação)
├── style.css       # Estilos — cores SENAI: azul #003087 / laranja #F47920
├── app.js          # Lógica frontend (cache, disponibilidade, renderização)
├── Code.gs         # Backend Google Apps Script (leitura/escrita na planilha)
├── Logo-SENAI_EP.png
└── Logo-S.png
```

---

## Tecnologias

- **Frontend**: HTML5 + CSS3 + JavaScript puro (sem frameworks)
- **Backend / banco de dados**: Google Sheets via Google Apps Script Web App
- **Fontes**: Barlow e Barlow Condensed (Google Fonts)
- **Fallback offline**: localStorage — funciona sem conexão com a planilha, mas os dados não são compartilhados entre dispositivos

---

## Como configurar

### 1. Planilha Google Sheets

1. Crie uma planilha no Google Drive
2. Abra **Extensões → Apps Script**
3. Substitua o conteúdo pelo arquivo `Code.gs` deste repositório
4. Salve (`Ctrl+S`)
5. Execute a função `inicializarPlanilha` uma vez para criar a aba `Reservas` com os cabeçalhos corretos
6. Clique em **Implantar → Nova implantação**
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
7. Copie a URL gerada (termina em `/exec`)

### 2. Configurar a URL da planilha

A URL do Apps Script fica diretamente no `app.js` (linha 8). Substitua pelo endereço gerado na implantação:
```javascript
const API_URL = 'https://script.google.com/macros/s/SEU_ID_AQUI/exec';
```

### 3. Configurar a senha de exportação

A senha fica armazenada nas **Script Properties** do Apps Script — nunca no código-fonte nem no repositório. Para definir:

1. No editor do Apps Script, clique no ícone de engrenagem (**Configurações do projeto**)
2. Role até **Propriedades do script** → clique em **Adicionar propriedade**
3. Preencha:
   - **Nome:** `EXPORT_PASS`
   - **Valor:** sua senha segura
4. Salve

> A senha é verificada pelo servidor a cada tentativa de login. O browser nunca recebe nem armazena a senha correta.

---

## Reimplantando após atualizar o Code.gs

Sempre que o `Code.gs` for alterado, é necessário criar uma nova versão da implantação — caso contrário o servidor continua rodando o código antigo:

1. **Implantar → Gerenciar implantações**
2. Clique no **lápis (editar)** da implantação existente
3. Em "Versão", selecione **Nova versão**
4. Clique em **Implantar**

A URL permanece a mesma.

---

## Estrutura da planilha (aba `Reservas`)

| Coluna | Campo |
|---|---|
| A | ID único |
| B | Nome |
| C | CPF |
| D | Carrinho |
| E | Quantidade de notebooks |
| F | Slots JSON (`[{"retirada":"YYYY-MM-DDTHH:MM","devolucao":"..."}]`) |
| G | Status (`ativa` / `cancelada` / `devolvida`) |
| H | Criado em (ISO) |
| I | Devolvido em (ISO) |

A devolução é marcada automaticamente pelo servidor a cada consulta (`processAutoReturn`), com base no horário de devolução informado.

---

## Variáveis de configuração (`app.js`)

| Variável | Descrição | Padrão |
|---|---|---|
| `API_URL` | URL do Apps Script implantado | — |
| `MAX_NB` | Máximo de notebooks por carrinho | `35` |
| `CACHE_TTL` | Tempo de vida do cache em ms | `30000` (30s) |

> A senha de acesso à área restrita é configurada via **Script Properties** no Apps Script (propriedade `EXPORT_PASS`), não no `app.js`.
