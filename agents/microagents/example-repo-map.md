---
name: example-repo-map
description: 示例 microagent——用户提到仓库地图/结构时注入用法提示
triggers:
  - repo map
  - 仓库地图
  - 代码结构
---

# Repo map 用法

需要了解工作区结构时，调用 MCP 工具 **repo_map**（可选 `query` 聚焦符号/路径）。

返回按 import 图 PageRank + 查询个性化排序的文件与符号摘要，优先读高分文件再改代码。
