"""
LangGraph-based agent runner.

设计目标：
- 兼容主服务端 OpenAI-兼容 v1 接口（不要求支持 tools/tool_calls）。
- 使用 LangGraph 做“规划->调用工具->观察->再规划”的状态机编排（社区主流做法）。
- 工具来源：主服务端 MCP（/api/mcp/tools + /api/mcp/tools/call）

注意：
- 因为主服务端 v1 目前不实现 OpenAI 的原生 tools 语义，这里采用“JSON 决策协议”：
  LLM 只输出 JSON：{"type":"tool","name":"x.y","args":{...}} 或 {"type":"final","final":"..."}
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import json
import re
import logging

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
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


def _validate_decision(obj: Dict[str, Any], tool_names: List[str]) -> Tuple[str, Dict[str, Any]]:
    t = (obj.get("type") or "").strip().lower()
    if t == "final":
        return ("final", {"final": str(obj.get("final") or "")})
    if t == "tool":
        name = str(obj.get("name") or "").strip()
        if tool_names and name not in tool_names:
            raise ValueError(f"tool not allowed: {name}")
        args = obj.get("args") or {}
        if not isinstance(args, dict):
            raise ValueError("args must be an object")
        return ("tool", {"name": name, "args": args})
    raise ValueError("type must be 'tool' or 'final'")


class AgentDeps:
    """依赖注入容器，用于 run_agent 函数。"""
    def __init__(self, main_server_url: str, provider_or_model: str, temperature: float, max_tokens: int, max_steps: int, verbose: bool, use_tools: bool, get_mcp_tools: Any, call_mcp_tool: Any, timeout: int = 60):
        self.main_server_url = main_server_url
        self.provider_or_model = provider_or_model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.max_steps = max_steps
        self.verbose = verbose
        self.use_tools = use_tools
        self.get_mcp_tools = get_mcp_tools
        self.call_mcp_tool = call_mcp_tool
        self.timeout = timeout

async def run_agent(messages: list, deps: AgentDeps) -> str:
    question = _extract_text(messages)
    if not question:
        return ""

    tools: List[dict] = []
    if deps.use_tools:
        try:
            tools = _compact_tools(await deps.get_mcp_tools())
        except Exception as e:
            logger.warning(f"获取MCP工具失败: {e}，继续执行但无工具可用")
            tools = []
    tool_names = [t["name"] for t in tools]

    # 配置 LLM 客户端，添加超时和错误处理
    # 注意：timeout参数应该是秒数，但ChatOpenAI可能期望的是float或int
    llm = ChatOpenAI(
        base_url=f"{deps.main_server_url}/api/v1",
        api_key="xrk-agt",
        model=deps.provider_or_model,
        temperature=deps.temperature,
        max_tokens=deps.max_tokens,
        timeout=int(deps.timeout) if deps.timeout else 60,
        max_retries=2,
    )

    async def plan_node(state: AgentState) -> AgentState:
        scratch = state.get("scratchpad") or ""
        prompt = _build_decision_prompt(question, tools, scratch)
        
        try:
            resp = await llm.ainvoke([HumanMessage(content=prompt)])
            text = (getattr(resp, "content", None) or "").strip()
        except Exception as e:
            error_msg = str(e)
            logger.error(f"[agent.plan] LLM调用失败: {error_msg}")
            # 如果LLM调用失败，返回错误信息作为最终答案
            state["decision"] = {"kind": "final", "final": f"抱歉，AI调用失败: {error_msg}。请检查主服务端是否正常运行。"}
            return state
        
        if deps.verbose:
            logger.info(f"[agent.plan] raw={text[:500]}")
        
        try:
            obj = _extract_json_obj(text)
            kind, payload = _validate_decision(obj, tool_names)
            state["decision"] = {"kind": kind, **payload}
        except Exception as e:
            logger.error(f"[agent.plan] JSON解析失败: {e}, text={text[:200]}")
            # JSON解析失败时，尝试将原始文本作为最终答案
            state["decision"] = {"kind": "final", "final": text if text else "抱歉，AI返回格式异常。"}
        
        return state

    async def act_node(state: AgentState) -> AgentState:
        decision = state.get("decision") or {}
        if decision.get("kind") != "tool":
            return state
        name = decision.get("name")
        args = decision.get("args") or {}
        result = await deps.call_mcp_tool(name, args)
        obs = json.dumps(result, ensure_ascii=False)
        scratch = state.get("scratchpad") or ""
        scratch += f"\nCALL {name} args={json.dumps(args, ensure_ascii=False)}\nOBS {obs}\n"
        state["scratchpad"] = scratch
        state["last_tool"] = name
        state["last_result"] = result
        return state

    def route(state: AgentState) -> str:
        decision = state.get("decision") or {}
        if decision.get("kind") == "final":
            return "final"
        steps = int(state.get("steps") or 0)
        if steps >= deps.max_steps:
            return "final"
        return "act"

    async def bump_steps(state: AgentState) -> AgentState:
        state["steps"] = int(state.get("steps") or 0) + 1
        return state

    graph = StateGraph(AgentState)
    graph.add_node("plan", plan_node)
    graph.add_node("act", act_node)
    graph.add_node("bump", bump_steps)
    graph.set_entry_point("plan")
    graph.add_conditional_edges("plan", route, {"act": "act", "final": END})
    graph.add_edge("act", "bump")
    graph.add_edge("bump", "plan")

    app = graph.compile()

    init: AgentState = {"scratchpad": "", "steps": 0}
    
    try:
        final_state = await app.ainvoke(init)
    except Exception as e:
        logger.error(f"[agent] graph执行失败: {e}", exc_info=True)
        return f"抱歉，Agent执行失败: {str(e)}"
    
    # 处理 final_state 为 None 的情况
    if not final_state:
        logger.error("[agent] final_state 为 None")
        return "抱歉，Agent执行异常，未返回有效结果。"
    
    decision = final_state.get("decision") or {}
    if decision.get("kind") == "final":
        return str(decision.get("final") or "")

    # 达到上限：给一个可解释的兜底
    return "已达到最大步骤限制，无法继续自动调用工具。请缩小问题或减少工具调用需求。"

