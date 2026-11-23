import { escapeHtml, formatInteger, formatMicrosToUsd } from '/assets/format.js';

const BASE_URL = 'https://api.tiencoder.tech/v1';

const FALLBACK_MODELS = [
  {
    id: 'ag/gemini-3.8-flash',
    inputMicrosPerMillion: 300_000,
    outputMicrosPerMillion: 2_500_000,
    maxInputTokens: 32_768,
    maxOutputTokens: 4_096,
    chatOutputLimitField: 'max_tokens',
  },
];

const dom = {
  mobileMenuBtn: document.getElementById('mobile-menu-btn'),
  mobileDrawer: document.getElementById('mobile-drawer'),
  navAuthGuest: document.getElementById('nav-auth-guest'),
  navAuthUser: document.getElementById('nav-auth-user'),
  navUsername: document.getElementById('nav-username'),
  heroPrimaryCta: document.getElementById('hero-primary-cta'),
  navModelsLink: document.getElementById('nav-models-link'),
  openLinesModalBtn: document.getElementById('open-lines-modal-btn'),
  linesModal: document.getElementById('lines-modal'),
  linesModalSub: document.getElementById('lines-modal-sub'),
  linesModalBody: document.getElementById('lines-modal-body'),
  closeLinesModal: document.getElementById('close-lines-modal'),
  copyBaseUrlBtn: document.getElementById('copy-base-url-btn'),
  passportModelTabs: document.getElementById('passport-model-tabs'),
  ticketSelectedModel: document.getElementById('ticket-selected-model'),
  ticketModelPrice: document.getElementById('ticket-model-price'),
  ticketModelLimits: document.getElementById('ticket-model-limits'),
  liveLineChips: document.getElementById('live-line-chips'),
  landingModelsTbody: document.getElementById('landing-models-tbody'),
  modelsCatalogSummary: document.getElementById('models-catalog-summary'),
  codeFilename: document.getElementById('code-filename'),
  codeSnippet: document.getElementById('code-snippet'),
  copyCodeBtn: document.getElementById('copy-code-btn'),
  simulateBtn: document.getElementById('simulate-btn'),
  simOutput: document.getElementById('sim-output'),
};

let models = [...FALLBACK_MODELS];
let activeModelIndex = 0;
let activeLang = 'python';

function shortLabel(modelId) {
  return modelId.replace(/^ag\//, '').replace(/^antigravity\//, '');
}

function buildSnippets(modelId) {
  return {
    python: {
      filename: 'quick-start.py · api.tiencoder.tech/v1',
      code: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE_URL}",
    api_key="gw_your_api_key_here",
)

res = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Xin chào TienCoder API!"}],
    stream=True,
)

for chunk in res:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`,
    },
    curl: {
      filename: 'request.sh · api.tiencoder.tech/v1',
      code: `curl -sS ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer gw_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelId}",
    "stream": true,
    "messages": [{"role": "user", "content": "Xin chào TienCoder API!"}]
  }'`,
    },
    js: {
      filename: 'index.ts · api.tiencoder.tech/v1',
      code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE_URL}",
  apiKey: process.env.TIENCODER_API_KEY,
});

const stream = await client.chat.completions.create({
  model: "${modelId}",
  messages: [{ role: "user", content: "Xin chào TienCoder API!" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`,
    },
    go: {
      filename: 'main.go · api.tiencoder.tech/v1',
      code: `client := openai.NewClient(
  option.WithBaseURL("${BASE_URL}"),
  option.WithAPIKey(os.Getenv("TIENCODER_API_KEY")),
)

resp, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
  Model: openai.F("${modelId}"),
  Messages: openai.F([]openai.ChatCompletionMessageParamUnion{
    openai.UserMessage("Xin chào TienCoder API!"),
  }),
})`,
    },
    rust: {
      filename: 'main.rs · api.tiencoder.tech/v1',
      code: `let config = OpenAIConfig::new()
    .with_api_base("${BASE_URL}")
    .with_api_key(std::env::var("TIENCODER_API_KEY")?);

let client = Client::with_config(config);
let req = CreateChatCompletionRequestArgs::default()
    .model("${modelId}")
    .messages([ChatCompletionRequestUserMessage::from("Xin chào!").into()])
    .build()?;`,
    },
  };
}

function renderPassportTicket() {
  const current = models[activeModelIndex] ?? models[0];
  dom.passportModelTabs.innerHTML = models
    .slice(0, 6)
    .map(
      (model, index) => `
      <button
        type="button"
        class="model-tab-btn ${index === activeModelIndex ? 'active' : ''}"
        data-model-index="${index}"
        role="tab"
        aria-selected="${index === activeModelIndex}"
      >
        ${escapeHtml(shortLabel(model.id))}
      </button>
    `,
    )
    .join('');

  const cachedRate = current.cachedInputMicrosPerMillion ?? Math.round((current.inputMicrosPerMillion ?? 0) * 0.25);
  dom.ticketSelectedModel.textContent = current.id;
  dom.ticketModelPrice.textContent =
    `Vào: ${formatMicrosToUsd(current.inputMicrosPerMillion)} · Đệm (25%): ${formatMicrosToUsd(cachedRate)} · Ra: ${formatMicrosToUsd(current.outputMicrosPerMillion)} / 1M`;
  dom.ticketModelLimits.textContent = `Max out: ${formatInteger(current.maxOutputTokens)} tok`;
  renderCodeWindow();
}

function renderLiveBarAndModal() {
  dom.liveLineChips.innerHTML = models
    .map(
      (model) => `
      <span class="live-chip">
        ${escapeHtml(model.id)}
        <strong>${escapeHtml(formatMicrosToUsd(model.inputMicrosPerMillion))}/1M</strong>
      </span>
    `,
    )
    .join('');

  if (dom.modelsCatalogSummary) {
    dom.modelsCatalogSummary.innerHTML =
      `Hiện có <strong>${models.length} model</strong> đang hoạt động (hỗ trợ <strong>Prompt Cache giảm 75%</strong> giá đầu vào) — bấm <strong>Sao chép ID</strong> để dán vào IDE/SDK.`;
  }

  if (dom.landingModelsTbody) {
    dom.landingModelsTbody.innerHTML = models
      .map(
        (model) => {
          const cachedRate = model.cachedInputMicrosPerMillion ?? Math.round((model.inputMicrosPerMillion ?? 0) * 0.25);
          return `
        <tr>
          <td>
            <div class="mono"><strong>${escapeHtml(model.id)}</strong></div>
            <span class="sub-line"><span class="badge badge-success">Sẵn sàng</span></span>
          </td>
          <td class="num">${escapeHtml(formatMicrosToUsd(model.inputMicrosPerMillion))}</td>
          <td class="num"><strong style="color: #059669">${escapeHtml(formatMicrosToUsd(cachedRate))}</strong></td>
          <td class="num">${escapeHtml(formatMicrosToUsd(model.outputMicrosPerMillion))}</td>
          <td class="num">${escapeHtml(formatInteger(model.maxInputTokens))} / ${escapeHtml(formatInteger(model.maxOutputTokens))} tok</td>
          <td>
            <button type="button" class="btn btn-outline btn-sm" data-copy-model="${escapeHtml(model.id)}">Sao chép ID</button>
          </td>
        </tr>
      `;
        },
      )
      .join('');
  }

  dom.linesModalSub.textContent = `LIVE ROUTING TABLE · ${models.length} MODEL · CACHE 25%`;
  dom.linesModalBody.innerHTML = models
    .map(
      (model) => {
        const cachedRate = model.cachedInputMicrosPerMillion ?? Math.round((model.inputMicrosPerMillion ?? 0) * 0.25);
        return `
      <div class="line-row">
        <div>
          <div class="mono"><strong>${escapeHtml(model.id)}</strong></div>
          <span class="sub-line num">
            Max in: ${escapeHtml(formatInteger(model.maxInputTokens))} · Max out: ${escapeHtml(formatInteger(model.maxOutputTokens))} tok
          </span>
        </div>
        <div style="text-align: right" class="num">
          <button type="button" class="btn btn-outline btn-sm" data-copy-model="${escapeHtml(model.id)}">Sao chép ID</button>
          <span class="sub-line mono">
            In ${escapeHtml(formatMicrosToUsd(model.inputMicrosPerMillion))} · <span style="color: #059669; font-weight: 700">Cache ${escapeHtml(formatMicrosToUsd(cachedRate))}</span> · Out ${escapeHtml(formatMicrosToUsd(model.outputMicrosPerMillion))}
          </span>
        </div>
      </div>
    `;
      },
    )
    .join('');
}

function renderCodeWindow() {
  const current = models[activeModelIndex] ?? models[0];
  const snippets = buildSnippets(current.id);
  const entry = snippets[activeLang] ?? snippets.python;
  dom.codeFilename.textContent = entry.filename;
  dom.codeSnippet.textContent = entry.code;
}

async function copyText(text, buttonEl, defaultLabel) {
  try {
    await navigator.clipboard.writeText(text);
    buttonEl.textContent = 'Đã chép ✓';
    setTimeout(() => {
      buttonEl.textContent = defaultLabel;
    }, 1800);
  } catch {
    buttonEl.textContent = 'Ctrl+C';
  }
}

async function hydratePublicData() {
  try {
    const res = await fetch('/api/public/models', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.items) && data.items.length > 0) {
        models = data.items;
        activeModelIndex = 0;
        renderPassportTicket();
        renderLiveBarAndModal();
      }
    }
  } catch {
    // Keep graceful fallback model if offline
  }

  try {
    const meRes = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (meRes.ok) {
      const data = await meRes.json();
      if (data?.user?.username) {
        dom.navAuthGuest.classList.add('hidden');
        dom.navAuthUser.classList.remove('hidden');
        dom.navUsername.textContent = `@${data.user.username}`;
        dom.heroPrimaryCta.setAttribute('href', '/console');
        dom.heroPrimaryCta.querySelector('span').textContent = 'Mở Console quản lý khóa';
      }
    }
  } catch {
    // Guest view
  }
}

dom.passportModelTabs.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-model-index]');
  if (!btn) return;
  activeModelIndex = Number(btn.dataset.modelIndex) || 0;
  renderPassportTicket();
});

document.querySelectorAll('.lang-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    activeLang = btn.dataset.lang;
    document.querySelectorAll('.lang-tab').forEach((tab) => {
      const isSelected = tab === btn;
      tab.classList.toggle('active', isSelected);
      tab.setAttribute('aria-selected', String(isSelected));
    });
    renderCodeWindow();
  });
});

dom.copyBaseUrlBtn.addEventListener('click', () => {
  copyText(BASE_URL, dom.copyBaseUrlBtn, 'Sao chép');
});

dom.copyCodeBtn.addEventListener('click', () => {
  copyText(dom.codeSnippet.textContent, dom.copyCodeBtn, 'Sao chép');
});

dom.simulateBtn.addEventListener('click', () => {
  const current = models[activeModelIndex] ?? models[0];
  const sample = {
    id: 'chatcmpl-tc2026',
    object: 'chat.completion.chunk',
    model: current.id,
    choices: [{ index: 0, delta: { content: 'Xin chào! Kết nối qua TienCoder API /v1 thành công.' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 18, completion_tokens: 14, total_tokens: 32 },
  };
  dom.simOutput.textContent = `data: ${JSON.stringify(sample, null, 2)}\ndata: [DONE]`;
  dom.simOutput.classList.remove('hidden');
});

function openLinesModal(event) {
  if (event) event.preventDefault();
  dom.linesModal.showModal();
}

dom.openLinesModalBtn.addEventListener('click', openLinesModal);
dom.closeLinesModal.addEventListener('click', () => dom.linesModal.close());

document.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-copy-model]');
  if (!btn) return;
  copyText(btn.dataset.copyModel, btn, 'Sao chép ID');
});

dom.mobileMenuBtn.addEventListener('click', () => {
  const open = dom.mobileDrawer.classList.toggle('open');
  dom.mobileMenuBtn.setAttribute('aria-expanded', String(open));
});

renderPassportTicket();
renderLiveBarAndModal();
hydratePublicData();
