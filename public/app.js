const scenarios = {
  interview: {
    label: "面试",
    role: "AI Interviewer",
    goal: "完成自我介绍、项目经历和优势说明",
    starter: "Hello, welcome to the interview. Could you briefly introduce yourself?",
  },
  restaurant: {
    label: "点餐",
    role: "AI Server",
    goal: "完成点餐、询问推荐、处理特殊需求",
    starter: "Good evening. What would you like to order today?",
  },
  meeting: {
    label: "会议",
    role: "AI Teammate",
    goal: "汇报进度、说明阻塞、推进决策",
    starter: "Let's start with your update. What progress did you make this week?",
  },
  travel: {
    label: "旅行",
    role: "AI Staff",
    goal: "问路、确认预订、解决行程问题",
    starter: "Hello, how can I help you with your trip today?",
  },
  campus: {
    label: "校园",
    role: "AI Classmate",
    goal: "闲聊、约学习、讨论课程任务",
    starter: "Hey, are you ready for the group assignment?",
  },
};

const practiceStyles = {
  beginner: {
    label: "强提示",
    hint: "给句式，适合开口",
  },
  intermediate: {
    label: "标准",
    hint: "追问加少量提示",
  },
  advanced: {
    label: "少提示",
    hint: "更像真实对话",
  },
};

const HISTORY_STORAGE_KEY = "speakpilot.practiceHistory.v1";
const HISTORY_LIMIT = 20;

const state = {
  scenario: "interview",
  level: "intermediate",
  sessionId: createId(),
  sessionStartedAt: new Date().toISOString(),
  status: "ready",
  history: [],
  practiceHistory: [],
  activeHistoryId: "",
  feedbacks: [],
  latestFeedback: null,
  coachNote: "",
  summary: null,
  transcript: "",
  aiEnabled: false,
  recognition: null,
  recognizing: false,
  voiceIntent: false,
  voiceStatus: "idle",
  usedVoiceForTurn: false,
  voiceConfidence: null,
  finalTranscript: "",
  pronunciationMode: false,
  pronunciationTarget: "",
  pronunciationResult: null,
  speaking: true,
};

const app = document.querySelector("#app");

init();

async function init() {
  state.practiceHistory = loadPracticeHistory();
  await checkHealth();
  startSession({ shouldSpeak: false });
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    state.aiEnabled = Boolean(data.aiEnabled);
  } catch {
    state.aiEnabled = false;
  }
}

function render() {
  const scenario = scenarios[state.scenario];
  app.innerHTML = `
    <main class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">SP</div>
          <div>
            <h1>SpeakPilot</h1>
            <p>AI 英语口语陪练</p>
          </div>
        </div>

        <section class="panel">
          <div class="panel-title">练习场景</div>
          <div class="scenario-grid">
            ${Object.entries(scenarios)
              .map(
                ([key, item]) => `
                  <button class="choice ${state.scenario === key ? "active" : ""}" data-action="scenario" data-value="${key}">
                    <span>${item.label}</span>
                    <small>${item.goal}</small>
                  </button>
                `,
              )
              .join("")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-title">练习风格</div>
          <div class="style-grid">
            ${Object.entries(practiceStyles)
              .map(
                ([key, item]) => `
                  <button class="style-choice ${state.level === key ? "active" : ""}" data-action="level" data-value="${key}">
                    <span>${item.label}</span>
                    <small>${item.hint}</small>
                  </button>
                `,
              )
              .join("")}
          </div>
        </section>

        <section class="panel compact">
          <div class="panel-title">运行状态</div>
          <div class="status-line">
            <span class="dot ${state.aiEnabled ? "online" : "offline"}"></span>
            ${state.aiEnabled ? "真实 AI 模型已连接" : "本地兜底模式，可完整演示"}
          </div>
        </section>

        <section class="panel history-panel">
          <div class="panel-title row-title">
            <span>练习历史</span>
            <small>${state.practiceHistory.length}/${HISTORY_LIMIT}</small>
          </div>
          ${renderPracticeHistory()}
        </section>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div>
            <div class="eyebrow">${scenario.label}场景</div>
            <h2>${scenario.role}</h2>
            <p>${scenario.goal}</p>
          </div>
          <div class="topbar-actions">
            <button class="ghost" data-action="toggle-speech">${state.speaking ? "关闭朗读" : "开启朗读"}</button>
            <button class="ghost" data-action="reset">重置</button>
            <button class="primary" data-action="start">${state.history.length ? "重新开始" : "开始练习"}</button>
          </div>
        </header>

        <div class="main-grid">
          <section class="conversation" aria-live="polite">
            <div class="conversation-head">
              <div>
                <strong>实时对话</strong>
                <span>${state.history.length} 条消息</span>
              </div>
              <button class="secondary" data-action="summary" ${state.history.length < 2 ? "disabled" : ""}>生成课后总结</button>
            </div>
            <div class="messages">
              ${
                state.history.length
                  ? state.history.map(renderMessage).join("")
                  : `<div class="empty-state">
                      <h3>AI 正在准备场景开场</h3>
                      <p>建议用 3 到 5 轮短对话完成演示，再生成课后总结。</p>
                    </div>`
              }
            </div>

            <div class="composer">
              <textarea id="utterance" placeholder="也可以直接输入英文，例如：I am agree with this plan because it is efficient.">${escapeHtml(
                state.transcript,
              )}</textarea>
              <div class="voice-status ${state.voiceIntent ? "active" : ""}">
                <span class="voice-dot ${state.recognizing ? "listening" : ""}"></span>
                <span>${escapeHtml(getVoiceStatusText())}</span>
              </div>
              ${renderPronunciationPanel()}
              <div class="composer-actions">
                <button class="mic ${state.voiceIntent ? "recording" : ""}" data-action="voice">
                  ${state.voiceIntent ? "停止识别" : "连续语音输入"}
                </button>
                <button class="secondary" data-action="pronunciation">
                  ${state.pronunciationMode ? "完成复练" : "表达复练"}
                </button>
                <button class="primary" data-action="send" ${state.status === "thinking" ? "disabled" : ""}>
                  ${state.status === "thinking" ? "AI 思考中" : "发送"}
                </button>
              </div>
            </div>
          </section>

          <aside class="coach">
            <section class="panel feedback-panel">
              <div class="panel-title">即时反馈</div>
              ${renderFeedback(state.latestFeedback, state.coachNote)}
            </section>
            <section class="panel summary-panel">
              <div class="panel-title">课后总结</div>
              ${renderSummary(state.summary)}
            </section>
          </aside>
        </div>
      </section>
    </main>
  `;

  bindEvents();
  scrollMessagesToBottom();
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", handleAction);
  });

  const textarea = document.querySelector("#utterance");
  textarea?.addEventListener("input", (event) => {
    state.transcript = event.target.value;
    state.finalTranscript = state.transcript.trim();
    if (!state.voiceIntent && !state.pronunciationMode) {
      clearVoiceTurnState();
    }
  });
}

function scrollMessagesToBottom() {
  const messages = document.querySelector(".messages");
  if (!messages || !state.history.length) return;
  messages.scrollTop = messages.scrollHeight;
}

async function handleAction(event) {
  const target = event.currentTarget;
  const action = target.dataset.action;
  const value = target.dataset.value;

  if (action === "scenario") {
    state.scenario = value;
    startSession({ shouldSpeak: true });
    return;
  }

  if (action === "level") {
    state.level = value;
    render();
    return;
  }

  if (action === "start") {
    startSession();
    return;
  }

  if (action === "reset") {
    startSession({ shouldSpeak: false });
    return;
  }

  if (action === "send") {
    await sendUtterance();
    return;
  }

  if (action === "voice") {
    toggleVoiceInput();
    return;
  }

  if (action === "pronunciation") {
    togglePronunciationAssessment();
    return;
  }

  if (action === "summary") {
    await generateSummary();
    return;
  }

  if (action === "history-load") {
    loadHistoryEntry(value);
    return;
  }

  if (action === "history-delete") {
    deleteHistoryEntry(value);
    return;
  }

  if (action === "toggle-speech") {
    state.speaking = !state.speaking;
    window.speechSynthesis?.cancel();
    render();
  }
}

function startSession({ shouldSpeak = true } = {}) {
  resetSession(false);
  state.sessionId = createId();
  state.sessionStartedAt = new Date().toISOString();
  state.activeHistoryId = "";
  const starter = scenarios[state.scenario].starter;
  state.history.push({ role: "assistant", text: starter, time: nowTime() });
  render();
  if (shouldSpeak) speak(starter);
}

function resetSession(shouldRender) {
  state.history = [];
  state.feedbacks = [];
  state.latestFeedback = null;
  state.coachNote = "";
  state.summary = null;
  state.transcript = "";
  state.pronunciationMode = false;
  state.pronunciationTarget = "";
  state.pronunciationResult = null;
  state.status = "ready";
  stopVoiceInput();
  clearVoiceTurnState();
  window.speechSynthesis?.cancel();
  if (shouldRender) render();
}

async function sendUtterance() {
  if (state.pronunciationMode) {
    completePronunciationAssessment();
    return;
  }
  const usedVoice = state.usedVoiceForTurn;
  const voiceConfidence = state.voiceConfidence;
  stopVoiceInput();
  const textarea = document.querySelector("#utterance");
  const message = (textarea?.value || state.transcript || "").trim();
  if (!message || state.status === "thinking") return;

  state.history.push({ role: "user", text: message, time: nowTime() });
  state.transcript = "";
  state.status = "thinking";
  render();

  try {
    const response = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario: state.scenario,
        level: state.level,
        message,
        usedVoice,
        voiceConfidence,
        history: state.history,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "AI request failed");

    if (usedVoice && data.feedback) {
      data.feedback.pronunciationDetail = buildVoiceAssessment(message, voiceConfidence, data.feedback.pronunciation);
    }
    state.history.push({ role: "assistant", text: data.reply, time: nowTime() });
    state.latestFeedback = data.feedback;
    state.coachNote = data.coachNote || "";
    state.feedbacks.push(data.feedback);
    state.status = "ready";
    clearVoiceTurnState();
    render();
    speak(data.reply);
  } catch (error) {
    state.status = "ready";
    clearVoiceTurnState();
    state.latestFeedback = {
      score: 0,
      fluency: 0,
      accuracy: 0,
      vocabulary: 0,
      issues: [{ type: "system", original: message, suggestion: "请检查服务是否启动。", reason: error.message }],
      betterExpression: "服务异常时可以继续保留文本输入，恢复后重试。",
      praise: "演示链路已保留当前输入。",
    };
    state.coachNote = error.message;
    render();
  }
}

async function generateSummary() {
  if (state.status === "thinking") return;
  state.status = "thinking";
  render();

  try {
    const response = await fetch("/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario: state.scenario,
        history: state.history,
        feedbacks: state.feedbacks,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Summary request failed");
    state.summary = data;
  } catch (error) {
    state.summary = {
      overallScore: 0,
      summary: `总结生成失败：${error.message}`,
      strengths: [],
      mainProblems: ["请确认服务端是否正常运行"],
      nextGoals: ["恢复服务后重新生成总结"],
      practicePlan: [],
    };
  } finally {
    state.status = "ready";
    if (state.summary?.overallScore && state.history.length >= 2) {
      saveCurrentSessionSummary();
    }
    render();
  }
}

function loadHistoryEntry(id) {
  const entry = state.practiceHistory.find((item) => item.id === id);
  if (!entry) return;

  stopVoiceInput();
  window.speechSynthesis?.cancel();
  state.scenario = entry.scenario in scenarios ? entry.scenario : "interview";
  state.level = entry.level in practiceStyles ? entry.level : "intermediate";
  state.sessionId = entry.id;
  state.sessionStartedAt = entry.createdAt || new Date().toISOString();
  state.activeHistoryId = entry.id;
  state.history = Array.isArray(entry.history) ? entry.history : [];
  state.feedbacks = Array.isArray(entry.feedbacks) ? entry.feedbacks : [];
  state.latestFeedback = state.feedbacks.at(-1) || null;
  state.coachNote = "已打开历史练习摘要，可继续查看总结或点击重新开始进入新一轮。";
  state.summary = entry.summary || null;
  state.transcript = "";
  state.status = "ready";
  state.pronunciationMode = false;
  state.pronunciationTarget = "";
  state.pronunciationResult = null;
  render();
}

function deleteHistoryEntry(id) {
  state.practiceHistory = state.practiceHistory.filter((item) => item.id !== id);
  savePracticeHistory(state.practiceHistory);
  if (state.activeHistoryId === id) {
    state.activeHistoryId = "";
  }
  render();
}

function saveCurrentSessionSummary() {
  const scenario = scenarios[state.scenario];
  const createdAt = state.sessionStartedAt || new Date().toISOString();
  const savedAt = new Date().toISOString();
  const userTurns = state.history.filter((message) => message.role === "user").length;
  const existing = state.practiceHistory.filter((item) => item.id !== state.sessionId);
  const entry = {
    id: state.sessionId,
    scenario: state.scenario,
    scenarioLabel: scenario.label,
    level: state.level,
    levelLabel: practiceStyles[state.level]?.label || "标准",
    createdAt,
    savedAt,
    messageCount: state.history.length,
    userTurns,
    overallScore: Number(state.summary.overallScore) || 0,
    summaryText: state.summary.summary || "",
    history: state.history,
    feedbacks: state.feedbacks,
    summary: state.summary,
  };
  state.practiceHistory = [entry, ...existing].slice(0, HISTORY_LIMIT);
  state.activeHistoryId = entry.id;
  savePracticeHistory(state.practiceHistory);
}

function loadPracticeHistory() {
  try {
    const raw = window.localStorage?.getItem(HISTORY_STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function savePracticeHistory(items) {
  try {
    window.localStorage?.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
  } catch {
    state.coachNote = "浏览器本地存储不可用，历史摘要未保存。";
  }
}

function toggleVoiceInput() {
  if (state.voiceIntent) {
    if (state.pronunciationMode) {
      completePronunciationAssessment();
      return;
    }
    stopVoiceInput();
    render();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    state.latestFeedback = {
      score: 0,
      fluency: 0,
      accuracy: 0,
      vocabulary: 0,
      issues: [
        {
          type: "system",
          original: "SpeechRecognition",
          suggestion: "请使用 Chrome 或 Edge，或直接使用文本输入。",
          reason: "当前浏览器不支持 Web Speech API。",
        },
      ],
      betterExpression: "文本输入模式同样可以完成比赛演示。",
      praise: "已自动提供备用输入方式。",
    };
    state.coachNote = "当前浏览器不支持连续语音识别，建议使用 Chrome 或 Edge。";
    render();
    return;
  }

  state.voiceIntent = true;
  state.voiceStatus = "starting";
  state.pronunciationMode = false;
  state.usedVoiceForTurn = true;
  state.voiceConfidence = null;
  state.finalTranscript = state.transcript.trim();
  startRecognition(SpeechRecognition);
  render();
}

function togglePronunciationAssessment() {
  if (state.pronunciationMode) {
    completePronunciationAssessment();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    state.pronunciationResult = {
      score: 0,
      match: 0,
      confidence: 0,
      spoken: "",
      advice: "当前浏览器不支持语音识别，建议使用 Chrome 或 Edge。",
    };
    render();
    return;
  }

  const target = getPracticeTarget();
  if (!target) {
    state.pronunciationResult = {
      score: 0,
      match: 0,
      confidence: 0,
      spoken: "",
      advice: "请先用语音完成一轮回答，系统会基于本轮更自然表达生成复练目标。",
    };
    render();
    return;
  }

  stopVoiceInput();
  state.pronunciationMode = true;
  state.pronunciationTarget = target;
  state.pronunciationResult = null;
  state.transcript = "";
  state.finalTranscript = "";
  state.voiceConfidence = null;
  state.usedVoiceForTurn = false;
  state.voiceIntent = true;
  state.voiceStatus = "starting";
  startRecognition(SpeechRecognition);
  render();
}

function completePronunciationAssessment() {
  const spoken = state.transcript.trim();
  const target = state.pronunciationTarget;
  const confidence = state.voiceConfidence ?? 0;
  stopVoiceInput();
  state.pronunciationMode = false;
  state.pronunciationResult = evaluatePronunciation(target, spoken, confidence);
  render();
}

function startRecognition(SpeechRecognition) {
  if (!state.voiceIntent) return;

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onstart = () => {
    state.recognizing = true;
    state.voiceStatus = "listening";
    render();
  };
  recognition.onresult = (event) => {
    let interimTranscript = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0].transcript.trim();
      if (!text) continue;
      if (Number.isFinite(result[0].confidence) && result[0].confidence > 0) {
        state.voiceConfidence =
          state.voiceConfidence === null
            ? result[0].confidence
            : (state.voiceConfidence + result[0].confidence) / 2;
      }
      if (result.isFinal) {
        state.finalTranscript = [state.finalTranscript, text].filter(Boolean).join(" ");
      } else {
        interimTranscript = [interimTranscript, text].filter(Boolean).join(" ");
      }
    }
    state.transcript = [state.finalTranscript, interimTranscript].filter(Boolean).join(" ");
    const textarea = document.querySelector("#utterance");
    if (textarea) textarea.value = state.transcript;
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      state.voiceIntent = false;
      state.voiceStatus = "blocked";
      state.coachNote = "麦克风权限未开启，已切换为文本输入。";
      state.recognizing = false;
      render();
      return;
    }
    if (event.error === "no-speech") {
      state.recognizing = false;
      state.voiceStatus = "restarting";
      return;
    }
    state.coachNote = "语音识别暂时中断，系统会自动尝试继续监听。";
    state.recognizing = false;
    state.voiceStatus = "restarting";
    render();
  };
  recognition.onend = () => {
    state.recognizing = false;
    state.recognition = null;
    if (state.voiceIntent) {
      state.voiceStatus = "restarting";
      render();
      window.setTimeout(() => startRecognition(SpeechRecognition), 250);
    } else {
      render();
    }
  };

  state.recognition = recognition;
  try {
    recognition.start();
  } catch {
    state.voiceIntent = false;
    state.recognizing = false;
    state.voiceStatus = "error";
    state.coachNote = "语音识别启动失败，请刷新页面或改用文本输入。";
    render();
  }
}

function stopVoiceInput() {
  state.voiceIntent = false;
  if (state.recognition) {
    state.recognition.stop();
    state.recognition = null;
  }
  state.recognizing = false;
  state.voiceStatus = "idle";
  state.finalTranscript = state.transcript.trim();
}

function clearVoiceTurnState() {
  state.usedVoiceForTurn = false;
  state.voiceConfidence = null;
}

function getVoiceStatusText() {
  if (state.pronunciationMode && state.voiceStatus === "listening") {
    return "表达复练中：请朗读复练目标，读完点击完成复练。";
  }
  if (state.voiceStatus === "starting") return "正在启动麦克风，允许权限后即可连续说话。";
  if (state.voiceStatus === "listening") return "正在监听，可连续说英语；点击停止识别结束。";
  if (state.voiceStatus === "restarting") return "短暂停顿中，系统正在自动续听。";
  if (state.voiceStatus === "blocked") return "麦克风权限未开启，可改用文本输入。";
  if (state.voiceStatus === "error") return "语音识别启动失败，可刷新页面或使用文本输入。";
  return "可点击连续语音输入；Chrome 或 Edge 效果最好。";
}

function getLatestAssistantText() {
  const latest = [...state.history].reverse().find((message) => message.role === "assistant");
  return latest?.text || scenarios[state.scenario].starter;
}

function getLatestUserText() {
  const latest = [...state.history].reverse().find((message) => message.role === "user");
  return latest?.text || "";
}

function getPracticeTarget() {
  const betterExpression = cleanBetterExpression(state.latestFeedback?.betterExpression || "");
  if (betterExpression && !betterExpression.includes("This sentence works")) return betterExpression;
  return getLatestUserText();
}

function cleanBetterExpression(text) {
  return String(text || "")
    .replace(/^A clearer version:\s*/i, "")
    .replace(/^更自然表达[:：]\s*/i, "")
    .trim();
}

function buildVoiceAssessment(spoken, confidence, score) {
  const safeConfidence = confidence === null || confidence === undefined ? 0.65 : Math.max(0, Math.min(1, Number(confidence) || 0));
  const safeScore = Number(score) || Math.round(55 + safeConfidence * 40);
  return {
    spoken,
    confidence: Math.round(safeConfidence * 100),
    score: Math.max(0, Math.min(100, safeScore)),
    advice:
      safeScore >= 82
        ? "本轮语音识别稳定，关键词发音清楚。"
        : safeScore >= 68
          ? "本轮语音基本可识别，建议放慢语速并读清重音词。"
          : "本轮语音识别不够稳定，建议分短句回答并保持音量稳定。",
  };
}

function evaluatePronunciation(target, spoken, confidence) {
  if (!spoken) {
    return {
      score: 0,
      match: 0,
      confidence: 0,
      spoken: "",
      advice: "没有识别到朗读内容，请靠近麦克风并放慢语速再试一次。",
    };
  }

  const targetWords = normalizeWords(target);
  const spokenWords = normalizeWords(spoken);
  const distance = levenshteinDistance(targetWords, spokenWords);
  const maxLength = Math.max(targetWords.length, spokenWords.length, 1);
  const match = Math.max(0, 1 - distance / maxLength);
  const safeConfidence = Math.max(0, Math.min(1, Number(confidence) || 0.65));
  const score = Math.round(match * 65 + safeConfidence * 35);
  return {
    score,
    match: Math.round(match * 100),
    confidence: Math.round(safeConfidence * 100),
    spoken,
    advice:
      score >= 82
        ? "跟读内容和目标句匹配度较高，发音清晰度较好。"
        : score >= 65
          ? "整体可识别，但建议放慢语速，重点读清关键词。"
          : "识别文本和目标句差异较大，建议分短句跟读并保持稳定音量。",
  };
}

function normalizeWords(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function levenshteinDistance(left, right) {
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[left.length][right.length];
}

function speak(text) {
  if (!state.speaking || !window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = state.level === "beginner" ? 0.82 : state.level === "advanced" ? 1.02 : 0.92;
  window.speechSynthesis.speak(utterance);
}

function renderMessage(message) {
  const isUser = message.role === "user";
  return `
    <article class="message ${isUser ? "user" : "assistant"}">
      <div class="avatar">${isUser ? "You" : "AI"}</div>
      <div>
        <div class="bubble">${escapeHtml(message.text)}</div>
        <time>${message.time}</time>
      </div>
    </article>
  `;
}

function renderPracticeHistory() {
  if (!state.practiceHistory.length) {
    return `
      <div class="history-empty">
        <strong>暂无历史</strong>
        <p>生成课后总结后，会自动保存最近 ${HISTORY_LIMIT} 次练习摘要。</p>
      </div>
    `;
  }

  return `
    <div class="history-list">
      ${state.practiceHistory
        .map(
          (entry) => `
            <div class="history-item ${state.activeHistoryId === entry.id ? "active" : ""}">
              <button class="history-main" data-action="history-load" data-value="${escapeHtml(entry.id)}">
                <span>${escapeHtml(entry.scenarioLabel || "练习")}</span>
                <strong>${Number(entry.overallScore) || 0}</strong>
                <small>${escapeHtml(formatHistoryMeta(entry))}</small>
                <p>${escapeHtml(entry.summaryText || "已保存本轮练习摘要。")}</p>
              </button>
              <button class="history-delete" title="删除这条历史" data-action="history-delete" data-value="${escapeHtml(entry.id)}">删除</button>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderFeedback(feedback, coachNote = "") {
  if (!feedback) {
    return `
      <div class="placeholder">
        <strong>等待第一句回答</strong>
        <p>发送英文后，这里会显示分项评分、主要问题和更自然表达。</p>
      </div>
    `;
  }

  return `
    <div class="score-row">
      ${renderScore("总分", feedback.score)}
      ${renderScore("流利", feedback.fluency)}
      ${renderScore("准确", feedback.accuracy)}
      ${renderScore("词汇", feedback.vocabulary)}
      ${feedback.pronunciation ? renderScore("发音", feedback.pronunciation) : ""}
    </div>
    ${renderVoiceAssessment(feedback.pronunciationDetail)}
    <div class="coach-note">${escapeHtml(feedback.praise || "")}</div>
    ${coachNote ? `<div class="system-note">${escapeHtml(formatCoachNote(coachNote))}</div>` : ""}
    <div class="issue-list">
      ${
        feedback.issues?.length
          ? feedback.issues
              .map(
                (issue) => `
                  <div class="issue">
                    <span>${escapeHtml(issue.type)}</span>
                    <strong>${escapeHtml(issue.suggestion)}</strong>
                    <p>${escapeHtml(issue.reason)}</p>
                  </div>
                `,
              )
              .join("")
          : `<div class="issue success"><strong>暂无明显错误</strong><p>继续补充细节，让回答更像真实交流。</p></div>`
      }
    </div>
    <div class="better">
      <span>更自然表达</span>
      <p>${escapeHtml(feedback.betterExpression || "")}</p>
    </div>
  `;
}

function renderVoiceAssessment(detail) {
  if (!detail) return "";
  return `
    <div class="voice-assessment">
      <div class="voice-assessment-head">
        <span>本轮语音发音评估</span>
        <strong>${Number(detail.score) || 0}<small>/100</small></strong>
      </div>
      <dl>
        <dt>识别置信度</dt><dd>${Number(detail.confidence) || 0}%</dd>
        <dt>语音识别结果</dt><dd>${escapeHtml(detail.spoken || "未识别到内容")}</dd>
      </dl>
      <p>${escapeHtml(detail.advice || "")}</p>
    </div>
  `;
}

function renderPronunciationPanel() {
  if (!state.pronunciationTarget && !state.pronunciationResult) return "";
  const result = state.pronunciationResult;
  return `
    <div class="pronunciation-panel">
      <div>
        <span>复练目标</span>
        <p>${escapeHtml(state.pronunciationTarget || getPracticeTarget())}</p>
      </div>
      ${
        result
          ? `<div class="pronunciation-result">
              <strong>${result.score}<small>/100</small></strong>
              <p>${escapeHtml(result.advice)}</p>
              <dl>
                <dt>文本匹配</dt><dd>${result.match}%</dd>
                <dt>识别置信度</dt><dd>${result.confidence}%</dd>
              </dl>
              <em>识别结果：${escapeHtml(result.spoken || "未识别到内容")}</em>
            </div>`
          : `<small>点击「完成复练」后，系统会比较复练目标和识别文本，给出跟读准确度。</small>`
      }
    </div>
  `;
}

function renderSummary(summary) {
  if (state.status === "thinking") {
    return `<div class="placeholder"><strong>正在生成</strong><p>系统正在整理本轮表现。</p></div>`;
  }

  if (!summary) {
    return `<div class="placeholder"><strong>完成 2 条以上对话后生成</strong><p>总结会输出总分、优势、主要问题和下一次练习目标。</p></div>`;
  }

  return `
    <div class="summary-score">${summary.overallScore}<span>/100</span></div>
    <p class="summary-text">${escapeHtml(summary.summary)}</p>
    ${renderAbilityProfile(summary.abilityProfile)}
    ${renderErrorStats(summary.errorStats)}
    ${renderList("优势", summary.strengths)}
    ${renderList("主要问题", summary.mainProblems)}
    ${renderList("下一步目标", summary.nextGoals)}
    ${renderList("练习计划", summary.practicePlan)}
    ${renderDrills(summary.drills)}
  `;
}

function renderScore(label, value) {
  const score = Number(value) || 0;
  return `
    <div class="mini-score">
      <strong>${score}</strong>
      <span>${label}</span>
    </div>
  `;
}

function renderList(title, items = []) {
  if (!items.length) return "";
  return `
    <div class="summary-list">
      <strong>${title}</strong>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderAbilityProfile(items = []) {
  if (!items.length) return "";
  return `
    <div class="summary-block">
      <strong>能力画像</strong>
      <div class="ability-grid">
        ${items
          .map((item) => {
            const score = Number(item.score) || 0;
            return `
              <div class="ability-item">
                <div class="ability-top">
                  <span>${escapeHtml(item.label)}</span>
                  <b>${score}</b>
                </div>
                <div class="meter"><i style="width: ${Math.max(0, Math.min(100, score))}%"></i></div>
                <p>${escapeHtml(item.comment || "")}</p>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderErrorStats(items = []) {
  if (!items.length) return "";
  return `
    <div class="summary-block">
      <strong>错误统计</strong>
      <div class="stat-row">
        ${items
          .map(
            (item) => `
              <span class="stat-pill">
                ${escapeHtml(item.label)}
                <b>${Number(item.count) || 0}</b>
              </span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderDrills(items = []) {
  if (!items.length) return "";
  return `
    <div class="summary-block">
      <strong>复练任务</strong>
      <div class="drill-list">
        ${items
          .map(
            (item) => `
              <div class="drill-item">
                <span>${escapeHtml(item.title)}</span>
                <p>${escapeHtml(item.prompt)}</p>
                <small>${escapeHtml(item.target)}</small>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function nowTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatHistoryMeta(entry) {
  const date = entry.savedAt ? new Date(entry.savedAt) : null;
  const dateText =
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "刚刚";
  const level = practiceStyles[entry.level]?.label || entry.levelLabel || "标准";
  const turns = Number(entry.userTurns) || 0;
  return `${dateText} · ${level} · ${turns} 轮`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCoachNote(value) {
  const note = String(value || "");
  if (note.includes("稳定反馈模式")) {
    return "稳定反馈模式：当前由本地评分器保障低延迟反馈。";
  }
  if (note.includes("本地兜底模式")) {
    return "稳定反馈模式：无需模型也能完成练习闭环。";
  }
  return note;
}
