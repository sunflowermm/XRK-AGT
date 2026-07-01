# doc-pipeline 子服务插件

HTML 正文提取、简易 Markdown 转换。

## 依赖

```bash
cd subserver/pyserver
uv pip install -r apis/doc-pipeline/requirements.txt
```

## 终端命令

```text
sub> doc-pipeline status
sub> doc-pipeline update
```

## API

- `POST /api/doc-pipeline/extract` — `{"path":"data/.../page.html"}` 或 `{"text":"<html>..."}`
- `POST /api/doc-pipeline/markdown` — 同上，可选 `"save": true`
- `POST /api/doc-pipeline/command` — `{"cmd":"status"}`

配置：`data/doc-pipeline/config.yaml`
