import { escapeHtml, formatInteger, formatMicrosToUsd } from '/assets/format.js';

const BASE_URL = 'https://api.tiencoder.tech/v1';

const FALLBACK_MODELS = [
  {
    id: 'gemini-3.8-flash',
    inputMicrosPerMillion: 300_000,
    outputMicrosPerMillion: 2_500_000,
    maxInputTokens: 32_768,
    maxOutputTokens: 4_096,
  },
];

const dom = {
  navGuest: document.getElementById('docs-nav-guest'),
  navUser: document.getElementById('docs-nav-user'),
  navUsername: document.getElementById('docs-nav-username'),
  modelsCount: document.getElementById('docs-models-count'),
  modelsTbody: document.getElementById('docs-models-tbody'),
  rooSample: document.getElementById('roocode-model-sample'),
  cursorSample: document.getElementById('cursor-model-sample'),
  opencodeRunSample: document.getElementById('opencode-run-sample'),
  codeOpencode: document.getElementById('code-opencode'),
  codeCodex: document.getElementById('code-codex'),
  codePython: document.getElementById('code-python'),
  codeNode: document.getElementById('code-node'),
  codeShell: document.getElementById('code-shell'),
};

function buildOpenCodeConfig(primaryModel, proModel, items) {
  const byId = new Map(items.map((m) => [m.id, m]));
  const preferredOrder = [
    proModel,
    'gemini-4-hydrogen-high',
    'gemini-4-hydrogen-xhigh',
    'gemini-4-neon-high',
    'gemini-4-argon-high',
    primaryModel,
    'gemini-3.8-flash',
    'claude-opus-5-5-high',
    'claude-sonnet-5-5-high',
  ];
  const selectedIds = [];
  for (const id of preferredOrder) {
    if (id && byId.has(id) && !selectedIds.includes(id)) {
      selectedIds.push(id);
    }
  }
  for (const m of items) {
    if (selectedIds.length >= 6) break;
    if (!selectedIds.includes(m.id)) selectedIds.push(m.id);
  }

  const models = {};
  for (const id of selectedIds) {
    const m = byId.get(id);
    models[id] = {
      name: id,
      limit: {
        context: m?.maxInputTokens ?? 65536,
        output: m?.maxOutputTokens ?? 8192,
      },
    };
  }

  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      model: `tiencoder/${proModel}`,
      small_model: `tiencoder/${primaryModel}`,
      provider: {
        tiencoder: {
          npm: '@ai-sdk/openai-compatible',
          name: 'TienCoder API',
          options: {
            baseURL: BASE_URL,
            apiKey: 'gw_KEY_CUA_BAN',
          },
          models,
        },
      },
    },
    null,
    2,
  );
}

function renderSnippets(primaryModel, proModel, items) {
  if (dom.rooSample) dom.rooSample.textContent = primaryModel;
  if (dom.cursorSample) dom.cursorSample.textContent = proModel;
  if (dom.opencodeRunSample) {
    dom.opencodeRunSample.textContent = `opencode run --model tiencoder/${primaryModel} "Xin chào!"`;
  }
  if (dom.codeOpencode) {
    dom.codeOpencode.textContent = buildOpenCodeConfig(primaryModel, proModel, items);
  }

  dom.codeCodex.textContent = `[model_providers.tiencoder]
name = "TienCoder API"
base_url = "${BASE_URL}"
wire_api = "responses"
requires_openai_auth = false
env_key = "TIENCODER_API_KEY"

[profiles.tiencoder]
model_provider = "tiencoder"
model = "${primaryModel}"`;

  dom.codePython.textContent = `from openai import OpenAI

client = OpenAI(
    base_url="${BASE_URL}",
    api_key="gw_KEY_CUA_BAN",
)

stream = client.chat.completions.create(
    model="${primaryModel}",
    messages=[{"role": "user", "content": "Xin chào TienCoder API!"}],
    stream=True,
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`;

  dom.codeNode.textContent = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE_URL}",
  apiKey: process.env.TIENCODER_API_KEY, // gw_...
});

const stream = await client.chat.completions.create({
  model: "${primaryModel}",
  messages: [{ role: "user", content: "Xin chào TienCoder API!" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`;

  dom.codeShell.textContent = `# --- cURL (macOS / Linux / Git Bash) ---
curl -sS ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer gw_KEY_CUA_BAN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${primaryModel}",
    "stream": true,
    "messages": [{"role": "user", "content": "Xin chào!"}]
  }'

# --- PowerShell (Windows) ---
$key = Read-Host "Dan key gw_ cua ban"
$body = @{
  model = "${primaryModel}"
  messages = @(@{ role = "user"; content = "Xin chao!" })
} | ConvertTo-Json -Depth 4

Invoke-RestMethod -Uri "${BASE_URL}/chat/completions" \`
  -Method Post \`
  -Headers @{ Authorization = "Bearer $key" } \`
  -ContentType "application/json" \`
  -Body $body`;
}

function renderModels(items) {
  dom.modelsCount.textContent = `${items.length} model`;
  dom.modelsTbody.innerHTML = items
    .map(
      (m) => {
        const cachedRate = m.cachedInputMicrosPerMillion ?? Math.round((m.inputMicrosPerMillion ?? 0) * 0.25);
        return `
      <tr>
        <td class="mono"><strong>${escapeHtml(m.id)}</strong></td>
        <td class="num">${escapeHtml(formatMicrosToUsd(m.inputMicrosPerMillion))}</td>
        <td class="num"><strong style="color: #059669">${escapeHtml(formatMicrosToUsd(cachedRate))}</strong></td>
        <td class="num">${escapeHtml(formatMicrosToUsd(m.outputMicrosPerMillion))}</td>
        <td class="num">${escapeHtml(formatInteger(m.maxInputTokens))} / ${escapeHtml(formatInteger(m.maxOutputTokens))} tok</td>
        <td>
          <button type="button" class="btn btn-outline btn-sm" data-copy-text="${escapeHtml(m.id)}">Sao chép ID</button>
        </td>
      </tr>
    `;
      },
    )
    .join('');

  const flash = items.find((m) => m.id.includes('3.8-flash'))?.id ?? items[0].id;
  const flagship = items.find((m) => m.id.includes('hydrogen-high'))?.id
    ?? items.find((m) => m.id.includes('hydrogen') || m.id.includes('opus'))?.id
    ?? flash;
  renderSnippets(flash, flagship, items);
}

async function copyText(text, btn) {
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Đã chép ✓';
    setTimeout(() => {
      btn.textContent = original;
    }, 1500);
  } catch {
    btn.textContent = 'Ctrl+C';
  }
}

document.querySelectorAll('.lang-tab[data-tool]').forEach((tab) => {
  tab.addEventListener('click', () => {
    const selected = tab.dataset.tool;
    document.querySelectorAll('.lang-tab[data-tool]').forEach((btn) => {
      const active = btn === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.tool-panel').forEach((panel) => {
      panel.classList.toggle('hidden', panel.id !== `panel-${selected}`);
    });
  });
});

document.addEventListener('click', (event) => {
  const copyLiteralBtn = event.target.closest('button[data-copy-text]');
  if (copyLiteralBtn) {
    copyText(copyLiteralBtn.dataset.copyText, copyLiteralBtn);
    return;
  }
  const copyTargetBtn = event.target.closest('button[data-copy-target]');
  if (copyTargetBtn) {
    const target = document.getElementById(copyTargetBtn.dataset.copyTarget);
    if (target) copyText(target.textContent, copyTargetBtn);
  }
});

async function hydrate() {
  renderModels(FALLBACK_MODELS);
  try {
    const res = await fetch('/api/public/models', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.items) && data.items.length > 0) {
        renderModels(data.items);
      }
    }
  } catch {
    // Keep fallback
  }

  try {
    const meRes = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (meRes.ok) {
      const data = await meRes.json();
      if (data?.user?.username) {
        dom.navGuest.classList.add('hidden');
        dom.navUser.classList.remove('hidden');
        dom.navUsername.textContent = `@${data.user.username}`;
      }
    }
  } catch {
    // Guest
  }
}

hydrate();
