"""
LangGraph-based agent runner.

设计目标：
- 兼容主服务端 OpenAI-兼容 v3 接口（不要求支持 tools/tool_calls）。
- 使用 LangGraph 做“规划->调用工具->观察->再规划”的状态机编排（社区主流做法）。
- 工具来源：主服务端 MCP（/api/mcp/tools + /api/mcp/tools/call）

注意：
- v3 鉴权使用 body.apiKey（主服务端 Bot.apiKey），由 call_v3_chat 注入并传参。
- LLM 采用“JSON 决策协议”：{"type":"tool","name":"x.y","args":{...}} 或 {"type":"final","final":"..."}
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List
import json
import re
import logging

from langgraph.graph import StateGraph, END

logger = logging.getLogger(__name__)


class AgentState(Dict[str, Any]):
    """LangGraph state: dict-like."""


def _extract_text(messages: list) -> str:
    parts = []
    for m in messages or []:
        role = (m.get("role") or "user").strip()
        content = m.get("content")
        if isinstance(content, dict):
            content = content.get("text") or content.get("content") or json.dumps(content, ensure_ascii=False)
        if content is None:
            content = ""
        parts.append(f"{role}: {content}")
    return "\n".join(parts).strip()


def _compact_tools(raw_tools: List[dict]) -> List[dict]:
    cleaned: List[dict] = []
    for t in raw_tools or []:
        name = t.get("name") or ""
        if not name:
            continue
        desc = t.get("description") or ""
        schema = t.get("inputSchema") or {}
        schema_props = schema.get("properties") if isinstance(schema, dict) else None
        if isinstance(schema_props, dict) and schema_props:
            keys = ", ".join(list(schema_props.keys())[:30])
            desc = f"{desc} (args: {keys})"
        cleaned.append({"name": name, "description": desc})
    return cleaned


def _build_decision_prompt(question: str, tools: List[dict], scratchpad: str) -> str:
    tools_desc = "\n".join([f"- {t['name']}: {t['description']}" for t in tools]) if tools else "(无)"
    tool_names = ", ".join([t["name"] for t in tools]) if tools else ""

    return f"""你是一个“工具编排型”AI。你的目标是用最少步骤把问题解决。

可用工具：
{tools_desc}

你必须只输出 JSON（不要任何额外文字）。

当你需要调用工具时输出：
{{"type":"tool","name":"<tool_name>","args":{{...}}}}

当你可以直接回答时输出：
{{"type":"final","final":"..."}}

约束：
- 只允许选择这些工具：{tool_names}
- args 必须是 JSON 对象
- 如果工具返回 success=false，你要换一种方式或给出可执行的替代方案

问题：
{question}

已知过程（供你参考，不要重复输出）：
{scratchpad}
"""


def _extract_json_obj(text: str) -> Dict[str, Any]:
    """从模型输出中提取 JSON 对象（允许包在 ```json``` 里）。"""
    if not text:
        raise ValueError("empty model output")
    text = text.strip()
    # fenced
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
    if m:
        text = m.group(1).strip()
    # best-effort: find first {...}
    if not text.startswith("{"):
        m2 = re.search(r"(\{[\s\S]*\})", text)
        if m2:
            text = m2.group(1)
    obj = json.loads(text)
    if not isinstance(obj, dict):
        raise ValueError("model output is not a JSON object")
    return obj


def _validate_decision(obj: Dict[str, Any], tool_names: List[str]):
    t = (obj.get("type") or "").strip().lower()
    if t == "final":
        return "final", {"final": str(obj.get("final") or "")}
    if t == "tool":
        name = str(obj.get("name") or "").strip()
        if tool_names and name not in tool_names:
            raise ValueError(f"tool not allowed: {name}")
        args = obj.get("args") or {}
        if not isinstance(args, dict):
            raise ValueError("args must be an object")
        return "tool", {"name": name, "args": args}
    raise ValueError("type must be 'tool' or 'final'")


class AgentDeps:
    """依赖注入容器，用于 run_agent 函数。"""
    def __init__(
        self,
        provider_or_model: str,
        temperature: float,
        max_tokens: int,
        max_steps: int,
        verbose: bool,
        use_tools: bool,
        get_mcp_tools: Any,
        call_mcp_tool: Any,
        call_v3_chat: Callable[[str], Awaitable[str]],
        max_tools: int = 40,
    ):
        self.provider_or_model = provider_or_model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.max_steps = max_steps
        self.verbose = verbose
        self.use_tools = use_tools
        self.get_mcp_tools = get_mcp_tools
        self.call_mcp_tool = call_mcp_tool
        self.call_v3_chat = call_v3_chat
        self.max_tools = max_tools

async def run_agent(messages: list, deps: AgentDeps) -> str:
    question = _extract_text(messages)
    if not question:
        return ""

    tools: List[dict] = []
    if deps.use_tools:
        try:
            tools = _compact_tools(await deps.get_mcp_tools())
            if deps.max_tools > 0:
                tools = tools[:deps.max_tools]
        except Exception:
            pass
    tool_names = [t["name"] for t in tools]

    async def plan_node(state: AgentState) -> AgentState:
        """规划节点：调用LLM进行决策"""
        prompt = _build_decision_prompt(question, tools, state.get("scratchpad", ""))
        try:
            text = (await deps.call_v3_chat(prompt)).strip()
            obj = _extract_json_obj(text)
            kind, payload = _validate_decision(obj, tool_names)
            return {"decision": {"kind": kind, **payload}}
        except Exception as e:
            logger.error(f"[agent.plan] 失败: {e}")
            return {"decision": {"kind": "final", "final": f"处理失败: {str(e)[:100]}"}}

    async def act_node(state: AgentState) -> AgentState:
        """执行节点：调用MCP工具"""
        decision = state.get("decision", {})
        if decision.get("kind") != "tool":
            return {}
        name = decision.get("name")
        args = decision.get("args", {})
        result = await deps.call_mcp_tool(name, args)
        scratch = state.get("scratchpad", "")
        scratch += f"\nCALL {name} args={json.dumps(args, ensure_ascii=False)}\nOBS {json.dumps(result, ensure_ascii=False)}\n"
        return {"scratchpad": scratch, "last_tool": name, "last_result": result}

    def route(state: AgentState) -> str:
        """路由：tool->act, final->END, 其他->END"""
        decision = state.get("decision", {})
        kind = decision.get("kind")
        steps = int(state.get("steps", 0))
        
        if kind == "tool" and steps < deps.max_steps:
            return "act"
        return "final"

    async def check_max_steps(state: AgentState) -> AgentState:
        """增加步骤计数，超限时强制结束"""
        steps = int(state.get("steps", 0)) + 1
        updates = {"steps": steps}
        
        if steps >= deps.max_steps:
            updates["decision"] = {"kind": "final", "final": "已达到最大步骤限制。"}
        
        return updates

    def route_after_check(state: AgentState) -> str:
        return "final" if state.get("decision", {}).get("kind") == "final" else "plan"

    graph = StateGraph(AgentState)
    graph.add_node("plan", plan_node)
    graph.add_node("act", act_node)
    graph.add_node("check_steps", check_max_steps)
    graph.set_entry_point("plan")
    graph.add_conditional_edges("plan", route, {"act": "act", "final": END})
    graph.add_edge("act", "check_steps")
    graph.add_conditional_edges("check_steps", route_after_check, {"plan": "plan", "final": END})

    app = graph.compile()
    init: AgentState = {"scratchpad": "", "steps": 0}

    current_state = init.copy()
    async for chunk in app.astream(init):
        for node_name, node_output in chunk.items():
            if isinstance(node_output, dict) and not node_name.startswith("branch:"):
                if "decision" in node_output:
                    logger.info(f"[agent] {node_name} 设置 decision: {node_output['decision']}")
                current_state.update(node_output)

    decision = current_state.get("decision")
    if not decision or not isinstance(decision, dict) or decision.get("kind") != "final":
        logger.warning(f"[agent] decision无效: {decision}, state_keys={list(current_state.keys())}")
        return "抱歉，Agent未产生有效决策。"
    
    return str(decision.get("final") or "抱歉，AI返回了空回复。")

