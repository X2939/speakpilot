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

const levels = {
  beginner: "初级",
  intermediate: "中级",
  advanced: "高级",
};

const state = {
  scenario: "interview",
  level: "intermediate",
  status: "ready",
  history: [],
  feedbacks: [],
  latestFeedback: null,
  coachNote: "",
  summary: null,
  transcript: "",
  aiEnabled: false,
  recognition: null,
  recognizing: false,
  speaking: true,
};

const app = document.querySelector("#app");

init();

async function init() {
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
          <div class="panel-title">难度</div>
          <div class="segmented">
            ${Object.entries(levels)
              .map(
                ([key, label]) => `
                  <button class="${state.level === key ? "active" : ""}" data-action="level" data-value="${key}">${label}</button>
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
              <div class="composer-actions">
                <button class="mic ${state.recognizing ? "recording" : ""}" data-action="voice">
                  ${state.recognizing ? "停止识别" : "语音输入"}
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

  if (action === "summary") {
    await generateSummary();
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
  state.status = "ready";
  stopVoiceInput();
  window.speechSynthesis?.cancel();
  if (shouldRender) render();
}

async function sendUtterance() {
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
        history: state.history,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "AI request failed");

    state.history.push({ role: "assistant", text: data.reply, time: nowTime() });
    state.latestFeedback = data.feedback;
    state.coachNote = data.coachNote || "";
    state.feedbacks.push(data.feedback);
    state.status = "ready";
    render();
    speak(data.reply);
  } catch (error) {
    state.status = "ready";
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
    render();
  }
}

function toggleVoiceInput() {
  if (state.recognizing) {
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
    render();
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    state.recognizing = true;
    render();
  };
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0].transcript)
      .join(" ");
    state.transcript = transcript;
    const textarea = document.querySelector("#utterance");
    if (textarea) textarea.value = transcript;
  };
  recognition.onerror = () => {
    state.recognizing = false;
    render();
  };
  recognition.onend = () => {
    state.recognizing = false;
    render();
  };

  state.recognition = recognition;
  recognition.start();
}

function stopVoiceInput() {
  if (state.recognition) {
    state.recognition.stop();
    state.recognition = null;
  }
  state.recognizing = false;
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
    </div>
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
