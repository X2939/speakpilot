import json
import os
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    import httpx
except ImportError:  # pragma: no cover - optional runtime dependency
    httpx = None


ROOT_DIR = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT_DIR / "public"


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


load_dotenv(ROOT_DIR / ".env")


SCENARIOS: dict[str, dict[str, str]] = {
    "interview": {
        "name": "Job Interview",
        "role": "interviewer",
        "goal": "help the learner answer interview questions clearly and confidently",
    },
    "restaurant": {
        "name": "Restaurant Ordering",
        "role": "restaurant server",
        "goal": "help the learner order food, ask questions, and handle small problems",
    },
    "meeting": {
        "name": "Business Meeting",
        "role": "meeting colleague",
        "goal": "help the learner discuss progress, blockers, and decisions in a meeting",
    },
    "travel": {
        "name": "Travel Help",
        "role": "airport or hotel staff member",
        "goal": "help the learner ask for directions, solve travel issues, and confirm details",
    },
    "campus": {
        "name": "Campus Chat",
        "role": "classmate",
        "goal": "help the learner make small talk and discuss study plans",
    },
}


class ConversationMessage(BaseModel):
    role: str
    text: str
    time: str | None = None


class TurnRequest(BaseModel):
    scenario: str = "interview"
    level: str = "intermediate"
    message: str
    usedVoice: bool = False
    voiceConfidence: float | None = None
    history: list[ConversationMessage] = Field(default_factory=list)


class SummaryRequest(BaseModel):
    scenario: str = "interview"
    history: list[ConversationMessage] = Field(default_factory=list)
    feedbacks: list[dict[str, Any]] = Field(default_factory=list)


app = FastAPI(title="SpeakPilot API", version="0.2.0")
app.mount("/public", StaticFiles(directory=PUBLIC_DIR), name="public")


@app.get("/")
async def index() -> FileResponse:
    return no_store_file(ROOT_DIR / "index.html")


@app.get("/app.js")
async def app_js() -> FileResponse:
    return no_store_file(PUBLIC_DIR / "app.js")


@app.get("/styles.css")
async def styles_css() -> FileResponse:
    return no_store_file(PUBLIC_DIR / "styles.css")


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "aiEnabled": bool(os.getenv("OPENAI_API_KEY")),
        "model": os.getenv("OPENAI_MODEL") or "mock-coach",
        "backend": "fastapi",
    }


@app.post("/api/turn")
async def create_turn(payload: TurnRequest) -> dict[str, Any]:
    scenario = SCENARIOS.get(payload.scenario, SCENARIOS["interview"])
    user_text = payload.message.strip()

    if not user_text:
        return {
            "reply": "Please say one sentence in English so we can keep practicing.",
            "feedback": make_feedback(user_text, payload.voiceConfidence, payload.usedVoice),
            "coachNote": "等待用户输入。",
        }

    if not os.getenv("OPENAI_API_KEY"):
        return create_mock_turn(user_text, scenario, payload.level, payload.voiceConfidence, payload.usedVoice)

    messages = [
        {
            "role": "system",
            "content": (
                "You are SpeakPilot, an English speaking coach. Return strict JSON only. "
                'The JSON shape is {"reply":"short in-role English response",'
                '"feedback":{"score":number,"fluency":number,"accuracy":number,'
                '"vocabulary":number,"pronunciation":number,"issues":[{"type":"grammar|expression|vocabulary|pronunciation",'
                '"original":"...","suggestion":"...","reason":"Chinese explanation"}],'
                '"betterExpression":"...","praise":"Chinese short praise"},"coachNote":"Chinese teaching note"}. '
                "Keep reply under 45 words. Correct only the most useful issues. "
                "Only include a pronunciation score when usedVoice is true; otherwise set pronunciation to null. "
                "Do not switch the role-play to Chinese."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "scenario": scenario["name"],
                    "role": scenario["role"],
                    "goal": scenario["goal"],
                    "learnerLevel": payload.level,
                    "conversation": [item.model_dump() for item in payload.history[-8:]],
                    "learnerUtterance": user_text,
                    "usedVoice": payload.usedVoice,
                    "voiceConfidence": payload.voiceConfidence,
                },
                ensure_ascii=False,
            ),
        },
    ]

    try:
        ai_result = await call_chat_model(messages, temperature=0.35)
        return normalize_turn(ai_result, user_text, scenario, payload.voiceConfidence, payload.usedVoice)
    except Exception as exc:
        fallback = create_mock_turn(user_text, scenario, payload.level, payload.voiceConfidence, payload.usedVoice)
        fallback["coachNote"] = f"稳定反馈模式已接管：{format_error(exc)}"
        return fallback


@app.post("/api/summary")
async def create_summary(payload: SummaryRequest) -> dict[str, Any]:
    scenario = SCENARIOS.get(payload.scenario, SCENARIOS["interview"])

    if not os.getenv("OPENAI_API_KEY"):
        return create_mock_summary(
            [item.model_dump() for item in payload.history],
            payload.feedbacks,
            scenario,
        )

    messages = [
        {
            "role": "system",
            "content": (
                "You are an English speaking coach. Return strict JSON only. "
                'Shape: {"overallScore":number,"summary":"Chinese summary",'
                '"strengths":["..."],"mainProblems":["..."],"nextGoals":["..."],'
                '"practicePlan":["..."],'
                '"abilityProfile":[{"label":"流利度|准确性|词汇|场景完成度","score":number,"comment":"..."}],'
                '"errorStats":[{"label":"grammar|expression|fluency|vocabulary","count":number}],'
                '"drills":[{"title":"...","prompt":"...","target":"..."}]}. '
                "Be specific and actionable."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "scenario": scenario["name"],
                    "conversation": [item.model_dump() for item in payload.history],
                    "feedbacks": payload.feedbacks,
                },
                ensure_ascii=False,
            ),
        },
    ]

    try:
        ai_result = await call_chat_model(messages, temperature=0.25)
        return normalize_summary(ai_result, payload.feedbacks)
    except Exception as exc:
        summary = create_mock_summary(
            [item.model_dump() for item in payload.history],
            payload.feedbacks,
            scenario,
        )
        summary["summary"] += " 稳定总结模式已接管，系统已基于本轮评分和错误统计生成学习建议。"
        summary["summaryNote"] = f"模型总结降级原因：{format_error(exc)}"
        return summary


@app.exception_handler(Exception)
async def exception_handler(_, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "error": "SERVER_ERROR",
            "message": f"服务暂时不可用：{exc}",
        },
    )


@app.get("/{path:path}")
async def static_fallback(path: str):
    candidate = ROOT_DIR / path
    public_candidate = PUBLIC_DIR / path
    if candidate.exists() and candidate.is_file():
        return no_store_file(candidate)
    if public_candidate.exists() and public_candidate.is_file():
        return no_store_file(public_candidate)
    return PlainTextResponse("Not found", status_code=404)


def no_store_file(path: Path) -> FileResponse:
    return FileResponse(
        path,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


async def call_chat_model(messages: list[dict[str, str]], temperature: float) -> dict[str, Any]:
    if httpx is None:
        raise RuntimeError("httpx is required for real AI calls. Install it or use fallback mode.")

    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    api_key = os.getenv("OPENAI_API_KEY")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    if "openrouter.ai" in base_url:
        headers["HTTP-Referer"] = "http://localhost:5173"
        headers["X-Title"] = "SpeakPilot"

    async with httpx.AsyncClient(timeout=8) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json={
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "response_format": {"type": "json_object"},
            },
        )
        response.raise_for_status()
        data = response.json()

    content = data.get("choices", [{}])[0].get("message", {}).get("content", "{}")
    return parse_json_object(content)


def normalize_turn(
    ai: dict[str, Any],
    user_text: str,
    scenario: dict[str, str],
    voice_confidence: float | None = None,
    used_voice: bool = False,
) -> dict[str, Any]:
    fallback = create_mock_turn(user_text, scenario, "intermediate", voice_confidence, used_voice)
    feedback = ai.get("feedback") if isinstance(ai.get("feedback"), dict) else {}
    return {
        "reply": safe_string(ai.get("reply"), fallback["reply"]),
        "feedback": {
            "score": clamp_score(feedback.get("score"), fallback["feedback"]["score"]),
            "fluency": clamp_score(feedback.get("fluency"), fallback["feedback"]["fluency"]),
            "accuracy": clamp_score(feedback.get("accuracy"), fallback["feedback"]["accuracy"]),
            "vocabulary": clamp_score(feedback.get("vocabulary"), fallback["feedback"]["vocabulary"]),
            "pronunciation": (
                normalize_optional_score(feedback.get("pronunciation"), fallback["feedback"]["pronunciation"])
                if used_voice
                else None
            ),
            "issues": normalize_issues(feedback.get("issues"), fallback["feedback"]["issues"]),
            "betterExpression": safe_string(
                feedback.get("betterExpression"),
                fallback["feedback"]["betterExpression"],
            ),
            "praise": safe_string(feedback.get("praise"), fallback["feedback"]["praise"]),
        },
        "coachNote": safe_string(ai.get("coachNote"), fallback["coachNote"]),
    }


def normalize_summary(ai: dict[str, Any], feedbacks: list[dict[str, Any]]) -> dict[str, Any]:
    fallback = create_mock_summary([], feedbacks, SCENARIOS["interview"])
    return {
        "overallScore": clamp_score(ai.get("overallScore"), fallback["overallScore"]),
        "summary": safe_string(ai.get("summary"), fallback["summary"]),
        "strengths": normalize_list(ai.get("strengths"), fallback["strengths"]),
        "mainProblems": normalize_list(ai.get("mainProblems"), fallback["mainProblems"]),
        "nextGoals": normalize_list(ai.get("nextGoals"), fallback["nextGoals"]),
        "practicePlan": normalize_list(ai.get("practicePlan"), fallback["practicePlan"]),
        "abilityProfile": fallback["abilityProfile"],
        "errorStats": normalize_dict_list(ai.get("errorStats"), fallback["errorStats"]),
        "drills": normalize_dict_list(ai.get("drills"), fallback["drills"]),
    }


def create_mock_turn(
    user_text: str,
    scenario: dict[str, str],
    level: str,
    voice_confidence: float | None = None,
    used_voice: bool = False,
) -> dict[str, Any]:
    feedback = make_feedback(user_text, voice_confidence, used_voice)
    reply = build_fallback_reply(user_text, scenario)
    level_hint = build_level_hint(user_text, level)

    return {
        "reply": f"{reply} {level_hint}",
        "feedback": feedback,
        "coachNote": "当前为本地兜底模式：可完整演示流程。配置 API Key 后会切换为真实 AI 反馈。",
    }


def build_fallback_reply(user_text: str, scenario: dict[str, str]) -> str:
    words = [word for word in user_text.split() if word]
    lower = user_text.lower()
    role = scenario["role"]

    if is_unclear_input(user_text):
        return "I caught part of your answer, but some words were unclear. Could you say it again more slowly?"

    if role == "interviewer" and is_refusal(user_text):
        if any(word in lower for word in ["introduce", "selfintroduce", "slefintroduce"]):
            return "That's okay. You can skip a full self-introduction. Please start with one strength or one recent project."
        return "That's okay. Could you tell me what you would prefer to talk about, your project or your strength?"

    if len(words) < 4:
        if role == "interviewer":
            return "I need a little more information. You can answer with one strength, one project, or one reason."
        return "I need a little more information. Could you answer with a full sentence?"

    if role == "interviewer":
        if any(word in lower for word in ["introduce", "selfintroduce", "slefintroduce"]):
            return "No problem. Instead of a long self-introduction, could you share one strength and one example?"
        if any(word in lower for word in ["project", "study", "work", "internship"]):
            return "That sounds relevant. What was your specific responsibility, and what result did you achieve?"
        if any(word in lower for word in ["strength", "advantage", "good at", "skill"]):
            return "Good. Could you connect that strength with one project or learning experience?"
        if any(word in lower for word in ["student", "major", "school", "university"]):
            return "Nice start. Could you add one strength and one project experience to make your introduction stronger?"
        if any(word in lower for word in ["agree", "plan", "idea"]):
            return "Good. Why do you think this plan is better than the other options?"
        return "Thanks. Could you give me one concrete example to support your answer?"
    if role == "restaurant server":
        return "Sure. Would you like to add a drink or make any special request for your order?"
    if role == "meeting colleague":
        return "Understood. What decision do you want the team to make next?"
    if role == "airport or hotel staff member":
        return "I can help with that. Could you confirm the time, place, or booking number?"
    if role == "classmate":
        return "That makes sense. Do you want to study together or split the task first?"
    return "Thanks. Please add one more detail so we can continue the conversation."


def build_level_hint(user_text: str, level: str) -> str:
    if is_unclear_input(user_text):
        return "Use this pattern: 'I'm a student, and one strength is ...'."
    if len([word for word in user_text.split() if word]) < 5 or is_refusal(user_text):
        return "You can use: 'I think ... because ...' or 'One example is ...'."
    if level == "beginner":
        return "Use one or two simple sentences."
    if level == "advanced":
        return "Try to add a reason, a specific detail, and a result."
    return "Try to answer with a complete sentence and one detail."


def is_refusal(text: str) -> bool:
    lower = text.lower().strip()
    return bool(
        re.fullmatch(r"(no|nope|nah|not really)[.!?]*", lower)
        or re.search(r"\b(i\s+)?(do not|don't|dont|don t)\s+want\b", lower)
        or re.search(r"\b(i\s+)?(cannot|can't|cant)\s+(answer|say|tell|introduce)\b", lower)
    )


def is_unclear_input(text: str) -> bool:
    compact = re.sub(r"\s+", "", text.lower())
    words = [word for word in re.findall(r"[a-zA-Z]+", text.lower()) if word]
    if not compact:
        return False
    if re.search(r"([a-zA-Z])\1{6,}", text):
        return True
    if re.search(r"([a-zA-Z]{2,})\1{3,}", compact):
        return True
    long_words = [word for word in words if len(word) >= 14]
    if long_words and not any(word in long_words[0] for word in ["introduction", "responsibility"]):
        return True
    if len(compact) >= 18:
        unique_ratio = len(set(compact)) / len(compact)
        if unique_ratio < 0.28:
            return True
    return False


def create_mock_summary(
    history: list[dict[str, Any]],
    feedbacks: list[dict[str, Any]],
    scenario: dict[str, str],
) -> dict[str, Any]:
    scores = [float(item["score"]) for item in feedbacks if is_number(item.get("score"))]
    average = round(sum(scores) / len(scores)) if scores else 76
    ability_profile = build_ability_profile(feedbacks, average)
    error_stats = build_error_stats(feedbacks)
    drills = build_drills(feedbacks, scenario)
    return {
        "overallScore": average,
        "summary": (
            f"本轮完成了 {scenario['name']} 场景练习，共 {len(history)} 条对话。"
            "你已经能持续用英语回应，下一步要提高句子完整度和表达自然度。"
        ),
        "strengths": ["能保持对话推进", "多数回答能贴合场景任务"],
        "mainProblems": collect_problems(feedbacks),
        "nextGoals": ["每次回答补充一个具体细节", "减少中式直译表达", "优先使用完整句"],
        "practicePlan": ["复盘本轮被纠正的表达", "用更地道表达重说 3 遍", "明天换一个相邻场景继续练习"],
        "abilityProfile": ability_profile,
        "errorStats": error_stats,
        "drills": drills,
    }


def build_ability_profile(feedbacks: list[dict[str, Any]], fallback_score: int) -> list[dict[str, Any]]:
    fluency = average_metric(feedbacks, "fluency", fallback_score)
    accuracy = average_metric(feedbacks, "accuracy", fallback_score)
    vocabulary = average_metric(feedbacks, "vocabulary", fallback_score)
    pronunciation = average_metric(feedbacks, "pronunciation", fallback_score)
    completion = min(95, max(58, fallback_score + min(8, len(feedbacks) * 2)))
    profile = [
        {
            "label": "流利度",
            "score": fluency,
            "comment": "回答长度和连贯性基本可支撑对话。" if fluency >= 75 else "需要减少过短回答，补充原因和细节。",
        },
        {
            "label": "准确性",
            "score": accuracy,
            "comment": "主要语法点可控。" if accuracy >= 75 else "需要优先修正常见语法和拼写问题。",
        },
        {
            "label": "词汇",
            "score": vocabulary,
            "comment": "词汇能覆盖当前场景。" if vocabulary >= 75 else "建议积累场景高频表达和替代表达。",
        },
        {
            "label": "场景完成度",
            "score": completion,
            "comment": "能够跟随角色追问继续推进任务。" if completion >= 75 else "需要更明确地回应场景任务目标。",
        },
    ]
    if has_metric(feedbacks, "pronunciation"):
        profile.insert(
            3,
            {
                "label": "发音清晰度",
                "score": pronunciation,
                "comment": "语音识别稳定，发音清晰度较好。" if pronunciation >= 75 else "建议放慢语速，保证关键词发音清楚。",
            },
        )
    return profile


def build_error_stats(feedbacks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for feedback in feedbacks:
        for issue in feedback.get("issues", []) if isinstance(feedback.get("issues"), list) else []:
            issue_type = str(issue.get("type", "expression")).lower()
            counts[issue_type] = counts.get(issue_type, 0) + 1
    if not counts:
        return [{"label": "no major issue", "count": 0}]
    return [
        {"label": label, "count": count}
        for label, count in sorted(counts.items(), key=lambda item: item[1], reverse=True)
    ]


def build_drills(feedbacks: list[dict[str, Any]], scenario: dict[str, str]) -> list[dict[str, str]]:
    issues: list[dict[str, Any]] = []
    for feedback in feedbacks:
        if isinstance(feedback.get("issues"), list):
            issues.extend(feedback["issues"])

    drills = [
        {
            "title": "完整句复述",
            "prompt": "用一句完整英文回答 AI 的上一个问题，并补充一个 because 原因。",
            "target": "减少过短回答，提升流利度。",
        }
    ]
    if any(issue.get("type") == "grammar" for issue in issues):
        drills.append(
            {
                "title": "语法修正复练",
                "prompt": "把本轮被纠正的句子重说一遍，重点检查 I、don't、第三人称单数。",
                "target": "提升准确性评分。",
            }
        )
    if any(issue.get("type") == "expression" for issue in issues):
        drills.append(
            {
                "title": "地道表达替换",
                "prompt": f"围绕 {scenario['name']} 场景，用更自然的表达重新回答一次。",
                "target": "减少中式直译，提高表达自然度。",
            }
        )
    return drills[:3]


def average_metric(feedbacks: list[dict[str, Any]], key: str, fallback: int) -> int:
    values = [float(item[key]) for item in feedbacks if is_number(item.get(key))]
    return round(sum(values) / len(values)) if values else fallback


def has_metric(feedbacks: list[dict[str, Any]], key: str) -> bool:
    return any(is_number(item.get(key)) for item in feedbacks)


def make_feedback(text: str, voice_confidence: float | None = None, used_voice: bool = False) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    lower = text.lower()

    if not text.strip():
        issues.append(
            {
                "type": "expression",
                "original": "",
                "suggestion": "Please answer in a complete English sentence.",
                "reason": "需要先说出一句完整英文，系统才能继续评估。",
            }
        )
    if is_unclear_input(text):
        issues.append(
            {
                "type": "clarity",
                "original": text[:80],
                "suggestion": "Please say it again more slowly with clear word boundaries.",
                "reason": "输入中存在大量重复字符或不清晰片段，真实口语练习中应优先保证关键词能被听清。",
            }
        )
    if re.search(r"\bi am agree\b", lower):
        issues.append(
            {
                "type": "grammar",
                "original": "I am agree",
                "suggestion": "I agree",
                "reason": "agree 是动词，不需要加 am。",
            }
        )
    if re.search(r"\bi dont\b|\bi don t\b|\bi do not\b", lower):
        issues.append(
            {
                "type": "grammar",
                "original": "i dont",
                "suggestion": "I don't",
                "reason": "第一人称 I 需要大写；don't 需要撇号，口语书写更自然。",
            }
        )
    if re.search(r"\bslefintroduce\b|\bselfintroduce\b|\bself introduce\b", lower):
        issues.append(
            {
                "type": "expression",
                "original": "selfintroduce",
                "suggestion": "introduce myself",
                "reason": "英语里通常说 introduce myself，不说 selfintroduce。",
            }
        )
    if re.search(r",[^\s]", text):
        issues.append(
            {
                "type": "expression",
                "original": ",",
                "suggestion": "Add a space after the comma.",
                "reason": "英文标点后通常加空格，阅读更自然。",
            }
        )
    if re.search(r"\bvery like\b", lower):
        issues.append(
            {
                "type": "expression",
                "original": "very like",
                "suggestion": "really like",
                "reason": "英语里通常说 really like，不说 very like。",
            }
        )
    if re.search(r"\bhe go\b|\bshe go\b|\bit go\b", lower):
        issues.append(
            {
                "type": "grammar",
                "original": "he/she/it go",
                "suggestion": "he/she/it goes",
                "reason": "第三人称单数的一般现在时动词需要加 s。",
            }
        )
    if is_refusal(text):
        issues.append(
            {
                "type": "expression",
                "original": text,
                "suggestion": "Try: I prefer to talk about my project because ...",
                "reason": "拒绝回答时也要给出替代方向，这样对话才能继续推进。",
            }
        )
    if len([word for word in text.split() if word]) < 5:
        issues.append(
            {
                "type": "fluency",
                "original": text,
                "suggestion": "Use: I think ... because ... / One example is ...",
                "reason": "回答偏短，真实对话中需要补充原因或细节；可以直接套用句式继续说。",
            }
        )

    clarity_penalty = 14 if is_unclear_input(text) else 0
    refusal_penalty = 6 if is_refusal(text) else 0
    score = max(45, 88 - len(issues) * 8 - clarity_penalty - refusal_penalty + min(8, len(text) // 28))
    grammar_count = len([issue for issue in issues if issue["type"] == "grammar"])
    pronunciation = estimate_pronunciation_score(text, voice_confidence, used_voice)
    return {
        "score": score,
        "fluency": max(45, score - (12 if is_unclear_input(text) else 8 if len(text) < 35 else 0)),
        "accuracy": max(55, score - grammar_count * 6),
        "vocabulary": max(45, score - (8 if is_unclear_input(text) else 3)),
        "pronunciation": pronunciation,
        "issues": issues[:3],
        "betterExpression": (
            "A clearer version: " + improve_sentence(text)
            if issues
            else "This sentence works. Try adding a specific example to sound more natural."
        ),
        "praise": "方向是对的，重点改掉这一个表达会更自然。" if issues else "这句话比较清楚，可以继续保持。",
    }


def estimate_pronunciation_score(text: str, voice_confidence: float | None, used_voice: bool) -> int | None:
    if not used_voice:
        return None
    confidence = voice_confidence if is_number(voice_confidence) else 0.72
    score = round(55 + max(0.0, min(1.0, float(confidence))) * 40)
    word_count = len([word for word in text.split() if word])
    if word_count < 4:
        score -= 8
    if re.search(r"\b(um+|uh+|er+)\b", text.lower()):
        score -= 5
    return max(45, min(98, score))


def improve_sentence(text: str) -> str:
    if not text.strip():
        return "I would like to answer with a complete sentence."
    if is_unclear_input(text):
        return "I'm a student, and one strength is that I learn quickly."
    if is_refusal(text):
        return "I prefer to talk about my project because it shows my skills."
    replacements = [
        (r"\bI am agree\b", "I agree"),
        (r"\bi dont\b", "I don't"),
        (r"\bi don t\b", "I don't"),
        (r"\bi do not\b", "I don't"),
        (r"\bslefintroduce\b", "introduce myself"),
        (r"\bselfintroduce\b", "introduce myself"),
        (r"\bself introduce\b", "introduce myself"),
        (r"\bvery like\b", "really like"),
        (r"\bhe go\b", "he goes"),
        (r"\bshe go\b", "she goes"),
        (r"\bit go\b", "it goes"),
    ]
    result = text
    for pattern, replacement in replacements:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    result = re.sub(r",(?=\S)", ", ", result)
    return result


def collect_problems(feedbacks: list[dict[str, Any]]) -> list[str]:
    issues: list[dict[str, Any]] = []
    for feedback in feedbacks:
        if isinstance(feedback.get("issues"), list):
            issues.extend(feedback["issues"])
    if not issues:
        return ["回答还可以更具体，建议多补充原因、例子和结果"]
    problems: list[str] = []
    seen: set[str] = set()
    for issue in issues:
        suggestion = str(issue.get("suggestion", "改进表达")).strip()
        reason = str(issue.get("reason", "让表达更自然")).strip()
        key = f"{suggestion}|{reason}"
        if key in seen:
            continue
        seen.add(key)
        problems.append(f"{suggestion}：{reason}")
        if len(problems) >= 4:
            break
    return problems or ["回答还可以更具体，建议多补充原因、例子和结果"]


def parse_json_object(content: str) -> dict[str, Any]:
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            return json.loads(content[start : end + 1])
    return {}


def safe_string(value: Any, fallback: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else fallback


def normalize_issues(value: Any, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return fallback
    return [item for item in value[:3] if isinstance(item, dict)] or fallback


def normalize_list(value: Any, fallback: list[str]) -> list[str]:
    if not isinstance(value, list):
        return fallback
    items = [str(item).strip() for item in value if str(item).strip()]
    return items[:6] or fallback


def normalize_dict_list(value: Any, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return fallback
    items = [item for item in value if isinstance(item, dict)]
    return items[:8] or fallback


def clamp_score(value: Any, fallback: int) -> int:
    if not is_number(value):
        return fallback
    number = float(value)
    if 0 < number <= 10:
        number *= 10
    return max(0, min(100, round(number)))


def normalize_optional_score(value: Any, fallback: Any) -> int | None:
    if value is None and fallback is None:
        return None
    if not is_number(value):
        return fallback if fallback is None else clamp_score(fallback, 0)
    return clamp_score(value, 0)


def is_number(value: Any) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def format_error(exc: Exception) -> str:
    message = str(exc).strip()
    return message or exc.__class__.__name__
