# system-Core/site — 站点根静态目录

AgentRuntime 默认静态根（`paths.www` / `server.domains[].staticRoot`），挂在 **`/`**（如 `/favicon.ico`）。

与 `www/xrk/`（控制台 `/xrk/`）分离：业务前端仍放 `www/<应用名>/`。

本地可放 `favicon.ico`、`robots.txt`、`404.html`；默认不强制入库。
