# SpeakPilot

SpeakPilot 是一款面向真实场景的 AI 英语口语陪练工具，适配七牛云 XEngineer 暑期实训营「AI 英语口语陪练」题目。

## Demo 视频

Demo 视频链接：待上传后填写

核心闭环：

```text
场景选择 -> 英语语音/文本输入 -> AI 角色对话 -> 即时纠错评分 -> 课后总结
```

## 当前功能

- 场景选择：面试、点餐、会议、旅行、校园交流
- 难度选择：初级、中级、高级
- 语音输入：基于浏览器 Web Speech API，Chrome/Edge 效果最好
- 文本备用输入：麦克风不可用时仍可完整演示
- AI 角色回复：后端支持 OpenAI 兼容接口
- 即时纠错：输出总分、流利度、准确性、词汇评分
- 课后总结：输出能力画像、错误统计、优势、主要问题、下一步目标和复练任务
- 本地兜底模式：没有 API Key 时也能跑通完整 Demo

## 技术栈

当前版本采用静态前端 + FastAPI 后端：

- 前端：原生 HTML/CSS/JavaScript
- 后端：Python FastAPI
- AI 调用：`httpx` 调用 OpenAI 兼容 Chat Completions 接口
- 数据校验：Pydantic
- 语音识别：浏览器 Web Speech API
- 语音播放：浏览器 SpeechSynthesis

这样做的原因是：前端保持轻量，后端使用 Python 技术栈，便于后续扩展 SQLite、RAG、Agent、SSE 等能力。

## 运行方式

```bash
npm run dev
```

等价于：

```bash
uvicorn backend.app:app --host 0.0.0.0 --port 5173
```

打开：

```text
http://localhost:5173
```

语法检查：

```bash
npm run check
```

如果环境缺少依赖：

```bash
pip install -r requirements.txt
```

## 接入真实 AI

复制 `.env.example` 为 `.env`，填写 OpenAI 兼容接口：

```bash
cp .env.example .env
```

```env
OPENAI_API_KEY=你的 key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
```

如果不填写 `OPENAI_API_KEY`，系统会自动进入本地兜底模式，方便录制 Demo 和现场展示。

## Demo 讲解顺序

完整录制脚本见 [DEMO_SCRIPT.md](./DEMO_SCRIPT.md)。

1. 选择「面试」场景和「中级」难度。
2. 点击「开始练习」，AI 面试官先发问。
3. 点击「语音输入」说一句英文，或直接输入：

   ```text
   I am agree with this plan because it can help me learn fast.
   ```

4. 点击「发送」，展示 AI 追问和即时纠错。
5. 再完成 1 到 2 轮对话。
6. 点击「生成课后总结」，展示量化反馈和下一步练习计划。

## 可讲亮点

- 不是普通聊天机器人，而是围绕口语提升设计的任务型陪练。
- 纠错和追问分离：对话保持自然，同时右侧给出学习反馈。
- 量化反馈包含流利度、准确性、词汇和总分，方便衡量进步。
- 语音不可用或模型不可用时都有兜底，保证比赛演示稳定。

## API 说明

### `GET /api/health`

检查服务状态和模型配置。

### `POST /api/turn`

单轮口语练习接口。请求包含场景、难度、用户输入和历史对话，返回 AI 角色回复、即时评分、纠错建议和教学提示。

### `POST /api/summary`

课后总结接口。请求包含历史对话和每轮反馈，返回总分、能力画像、错误统计、主要问题、下一步目标和复练任务。

## 核心模块说明

- `backend/app.py`：FastAPI 后端，包含静态页面托管、AI 对话接口、总结接口、本地兜底评分逻辑。
- `public/app.js`：前端交互逻辑，负责场景选择、语音识别、对话状态、请求后端接口和渲染反馈。
- `public/styles.css`：页面样式，采用三栏布局：配置区、对话区、反馈区。
- `.env.example`：OpenAI 兼容接口配置示例。

课后总结会基于每轮即时反馈聚合：

- 能力画像：流利度、准确性、词汇、场景完成度
- 错误统计：grammar、expression、fluency、vocabulary 等问题数量
- 复练任务：根据本轮错误生成下一次训练目标

## 架构图

```text
Browser
  |-- Web Speech API: 英语语音 -> 文本
  |-- SpeechSynthesis: AI 回复 -> 语音播放
  |
  | HTTP JSON
  v
FastAPI Backend
  |-- /api/turn: 场景角色对话 + 即时纠错
  |-- /api/summary: 能力画像 + 错误统计 + 复练任务
  |-- fallback coach: 无 API Key 时保证可演示
  |
  v
OpenAI-compatible LLM
```

## 后续扩展

- 替换为实时语音模型，降低端到端延迟
- 增加发音音素级评分
- 保存历史练习报告，形成学习曲线
- 按 CEFR 等级动态调整问题难度
- 增加老师端或班级管理视图
