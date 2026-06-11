const http = require('http');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3210);
const OPENCLAW_NODE = process.env.OPENCLAW_NODE || '/root/.nvm/versions/node/v22.22.2/bin/node';
const OPENCLAW_ENTRY = process.env.OPENCLAW_ENTRY || '/root/.local/share/pnpm/global/5/.pnpm/openclaw@2026.4.2_@napi-rs+canvas@0.1.97/node_modules/openclaw/dist/index.js';
const OPENCLAW_AGENT = process.env.OPENCLAW_AGENT || 'main';
const OPENCLAW_TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS || 90000);

const DEFAULT_SUGGESTIONS = [
  { label: '昨晚只睡了五小时', kind: 'sleep' },
  { label: '我坐好久了', kind: 'sitting' },
  { label: '刚才运动了一下', kind: 'exercise' },
  { label: '我现在压力很大', kind: 'stress' },
];

const SCENE_LABELS = {
  stable: '稳定',
  tired: '睡眠不足',
  tense: '久坐紧张',
  weak: '连续透支',
  alert: '胸闷预警',
};

const PERSONALITY_LABELS = {
  approachable: '平易近人型',
  gentle: '温柔体贴型',
  cute: '撒娇依赖型',
  classical: '关公秦琼型',
  bro: '幽默哥们型',
  patient: '耐心引导型',
};

const SOUL_SCENE_REPLIES = {
  sleep: {
    approachable: '我昨晚只睡了五小时，有点缺觉，今晚早点休息吧。',
    gentle: '昨晚只睡了五小时，我知道你可能没办法，但身体确实会吃不消。今晚早点休息，好吗？',
    cute: '你怎么才睡五小时呀哥哥！今晚早点睡嘛，就早一点点也行。',
    classical: '昨夜只睡五小时，气力未复，今晚早些歇息。',
    bro: '五小时？你这是拿我当夜班保安用啊。行了，今晚早点睡，别再让我值班了。',
    patient: '哇，昨晚只睡了五小时，今天还能坚持到现在，你真的很厉害呀。不过身体有点累了，咱们今晚早一点休息好不好？'
  },
  sitting: {
    approachable: '坐好久了，起来走两步吧。',
    gentle: '你已经辛苦工作很久了，可以起来走一小会儿吗？',
    cute: '你坐好久了啦，我好闷，起来走两步嘛。',
    classical: '久坐伤身，起身走三分钟，活动活动气血。',
    bro: '还坐呢？椅子都快认你当亲戚了。起来走两步，让我也透口气。',
    patient: '你工作起来真的好专注，都坐了好久没动啦。我们起来走三分钟好不好？就这么一点点时间，你肯定能做到的。'
  },
  exercise: {
    approachable: '真舒服，谢谢你。',
    gentle: '你太厉害了，运动一下，我轻松多了。',
    cute: '刚才那几分钟我舒服多啦，算你有良心。',
    classical: '不错，你这一动，气血就活了。',
    bro: '可以啊，刚才那几分钟不白动。我这边松快了。',
    patient: '你刚才动得好棒呀！你看，连我都感觉轻松多了。谢谢你带着我一起活动。'
  },
  stress: {
    approachable: '你现在身处压力之中，你的身体有什么感受？',
    gentle: '肩膀放松，吸气呼气，你有感觉好一点吗？',
    cute: '你别一直绷着嘛，我知道这对你很重要，我很担心你，你能不能深呼吸一次，好不好？',
    classical: '先缓一口气，稳住阵脚。',
    bro: '你这压力一上来，我这边跟早高峰似的。先停一下，喝口水，别硬刚。',
    patient: '你现在有点绷着，但我知道你已经很努力了。先停下半分钟，喝口水，慢慢咽下去。'
  }
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error('request_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function getSoulSceneReply(sceneKey, personality) {
  const replies = SOUL_SCENE_REPLIES[sceneKey];
  if (!replies) return null;
  return replies[personality] || replies.approachable;
}

function localFallback(payload) {
  const text = cleanText(payload.message);
  const personality = payload.personality || 'approachable';

  if (/胸口|胸痛|胸闷|心慌|心悸|呼吸困难|出汗|左肩|左臂/.test(text)) {
    return {
      reply: '等等，这事不开玩笑。胸闷持续多久了？有没有胸痛、呼吸困难、出汗，或者左肩左臂不舒服？',
      serious: true,
      chips: [
        { label: '< 1 分钟，已缓解', kind: 'chest-mild' },
        { label: '仍在持续', kind: 'chest-persist' },
        { label: '有以上症状', kind: 'red-alert', danger: true }
      ],
      suggestions: DEFAULT_SUGGESTIONS,
      source: 'fallback'
    };
  }

  if (/五小时|5\s*小时|睡眠不足|缺觉|没睡够|熬夜/.test(text)) {
    return { reply: getSoulSceneReply('sleep', personality), suggestions: DEFAULT_SUGGESTIONS, source: 'fallback' };
  }
  if (/久坐|坐好久|坐太久|没动|走两步|站起来/.test(text)) {
    return { reply: getSoulSceneReply('sitting', personality), suggestions: DEFAULT_SUGGESTIONS, source: 'fallback' };
  }
  if (/运动|散步|跑了|走了|动了一下|出汗/.test(text)) {
    return { reply: getSoulSceneReply('exercise', personality), suggestions: DEFAULT_SUGGESTIONS, source: 'fallback' };
  }
  if (/压力|紧张|绷着|焦虑|放松|深呼吸|呼吸/.test(text)) {
    return { reply: getSoulSceneReply('stress', personality), suggestions: DEFAULT_SUGGESTIONS, source: 'fallback' };
  }

  return {
    reply: '我在。你现在不知道咋整也没事，先把话放这儿。要不先做一件小事：喝口水，慢一点。',
    suggestions: DEFAULT_SUGGESTIONS,
    source: 'fallback'
  };
}

function buildAgentMessage(payload) {
  const health = payload.health || {};
  const recentMessages = Array.isArray(payload.recentMessages) ? payload.recentMessages.slice(-8) : [];

  return [
    '你现在是心火 App 里的心脏 Agent。严格遵守 workspace 中的 IDENTITY.md 和 SOUL.md。',
    '请只输出 JSON，不要输出 Markdown，不要解释格式。',
    'JSON schema: {"reply":"string","serious":boolean,"suggestions":[{"label":"string","kind":"sleep|sitting|exercise|stress"}],"chips":[{"label":"string","kind":"string","danger":boolean}]}',
    '回复要短，第一人称“我”，不诊断疾病，不恐吓，不说算法分数。',
    '如果用户提到胸闷、胸痛、呼吸困难、出汗、左肩左臂不适、心悸，必须严肃，不幽默不撒娇，只做症状确认和就医/急救建议。',
    '',
    `当前人格: ${PERSONALITY_LABELS[payload.personality] || payload.personality || '平易近人型'}`,
    `当前场景: ${SCENE_LABELS[payload.scenario] || payload.scenario || '未知'}`,
    `心火名字: ${payload.heartName || '我的心脏'}`,
    `心率: ${health.heartRate ?? '未知'} bpm`,
    `心率区间: 0-200 bpm`,
    `上次更新时间: ${health.lastUpdated || '未知'}`,
    `睡眠: ${health.sleepHours ?? '未知'} 小时`,
    `数据来源: ${health.source || 'prototype'}`,
    '',
    '最近几轮聊天:',
    JSON.stringify(recentMessages, null, 2),
    '',
    `用户最新输入: ${cleanText(payload.message)}`
  ].join('\n');
}

function runOpenClaw(payload) {
  return new Promise((resolve, reject) => {
    const sessionId = `heartfire-${String(payload.clientSessionId || 'web').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'web'}`;
    const args = [
      OPENCLAW_ENTRY,
      'agent',
      '--agent', OPENCLAW_AGENT,
      '--session-id', sessionId,
      '--message', buildAgentMessage(payload),
      '--thinking', 'off',
      '--timeout', String(Math.ceil(OPENCLAW_TIMEOUT_MS / 1000)),
      '--json'
    ];

    const child = spawn(OPENCLAW_NODE, args, {
      cwd: '/root/.openclaw/workspace',
      env: { ...process.env, HOME: '/root' },
      timeout: OPENCLAW_TIMEOUT_MS + 5000,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`openclaw_exit_${code}: ${stderr.slice(-800)}`));
        return;
      }
      try {
        const parsed = extractJsonObject(`${stdout}\n${stderr}`);
        const text = parsed?.result?.payloads?.[0]?.text || parsed?.payloads?.[0]?.text || '';
        if (!text) throw new Error('empty_openclaw_reply');
        if (/Token Plan|用量上限|额度|insufficient/i.test(text)) {
          const err = new Error('openclaw_quota_exceeded');
          err.openclawText = text;
          throw err;
        }
        resolve(parseAgentText(text));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function extractJsonObject(output) {
  const text = String(output || '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (start === -1) {
      if (ch === '{') {
        start = i;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }
  throw new Error('openclaw_json_not_found');
}

function parseAgentText(text) {
  const trimmed = text.trim();
  try {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return normalizeAgentResponse(parsed, 'openclaw');
    }
  } catch (_) {
    // Fall through to plain text.
  }
  return normalizeAgentResponse({ reply: trimmed }, 'openclaw');
}

function normalizeAgentResponse(data, source) {
  return {
    reply: cleanText(data.reply || data.text || ''),
    serious: Boolean(data.serious),
    chips: Array.isArray(data.chips) ? data.chips.slice(0, 4) : undefined,
    suggestions: Array.isArray(data.suggestions) && data.suggestions.length
      ? data.suggestions.slice(0, 4).map(item => typeof item === 'string' ? { label: item, kind: 'stress' } : item)
      : DEFAULT_SUGGESTIONS,
    source,
  };
}

async function handleChat(req, res) {
  try {
    const raw = await readBody(req);
    const payload = JSON.parse(raw || '{}');
    if (!cleanText(payload.message)) {
      sendJson(res, 400, { error: 'message_required' });
      return;
    }

    const hasEmergencySignal = /胸口|胸痛|胸闷|心慌|心悸|呼吸困难|出汗|左肩|左臂/.test(cleanText(payload.message));
    if (hasEmergencySignal) {
      sendJson(res, 200, localFallback(payload));
      return;
    }

    try {
      const agentReply = await runOpenClaw(payload);
      sendJson(res, 200, agentReply);
    } catch (error) {
      const fallback = localFallback(payload);
      fallback.agentError = error.message;
      sendJson(res, 200, fallback);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'server_error' });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, service: 'heartfire-api' });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/heartfire/chat') {
    handleChat(req, res);
    return;
  }
  sendJson(res, 404, { error: 'not_found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`heartfire-api listening on 127.0.0.1:${PORT}`);
});
