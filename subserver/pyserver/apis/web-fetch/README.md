# web-fetch 子服务插件

HTTP 抓取与本地 JSON 缓存（标准库，无额外依赖）。

## 终端命令

```text
sub> web-fetch status
sub> web-fetch clear
sub> web-fetch update
```

## API

- `POST /api/web-fetch/fetch` — `{"url":"https://example.com","cache":true}`
- `GET /api/web-fetch/cache?url=https://example.com`
- `POST /api/web-fetch/command` — `{"cmd":"status"}`

配置：`data/web-fetch/config.yaml`
