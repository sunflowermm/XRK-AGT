# 插件模板

1. 复制本目录为 `apis/<组名>/`
2. 编写 `service.go`，在 `init()` 中 `core.RegisterPlugin(...)`
3. 在 `main.go` 增加：`_ "github.com/xrk-agt/goserver/apis/<组名>"`

字段对齐 pyserver `default` 字典：`group`、`plugin_dir`、`commands`、`routes`。
