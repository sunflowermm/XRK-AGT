package core

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
)

var (
	topCliAliases = map[string]string{"帮助": "help", "列表": "list", "组": "list"}
	cmdCliAliases = map[string]string{"状态": "status", "更新": "update", "同步": "sync", "帮助": "help"}
	exitCliWords  = map[string]struct{}{"exit": {}, "quit": {}, "q": {}, "退出": {}, "离开": {}}
)

func normalizeCliLine(line string) string {
	parts := strings.Fields(strings.TrimSpace(line))
	if len(parts) == 0 {
		return strings.TrimSpace(line)
	}
	if v, ok := topCliAliases[parts[0]]; ok {
		parts[0] = v
	} else if len(parts) >= 2 {
		if v, ok := cmdCliAliases[parts[1]]; ok {
			parts[1] = v
		}
	}
	return strings.Join(parts, " ")
}

func isExitLine(line string) bool {
	lower := strings.ToLower(strings.TrimSpace(line))
	if _, ok := exitCliWords[lower]; ok {
		return true
	}
	_, ok := exitCliWords[strings.TrimSpace(line)]
	return ok
}

type App struct {
	Config   Config
	Commands *CommandRegistry
	routes   map[string]http.HandlerFunc
	apis     []map[string]any
}

func NewApp(cfg Config) *App {
	return &App{
		Config:   cfg,
		Commands: NewCommandRegistry(),
		routes:   map[string]http.HandlerFunc{},
	}
}

func (a *App) RegisterPlugin(exp PluginExport) {
	if exp.Init != nil {
		exp.Init()
	}
	a.Commands.Register(exp)
	prefix := "/api/" + exp.Group

	a.Handle("GET", prefix+"/health", func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, 200, map[string]any{
			"ok": true, "group": exp.Group, "name": exp.Name,
			"commands": commandNames(exp.Commands),
		})
	})

	group := exp.Group
	a.Handle("POST", prefix+"/command", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Cmd   string   `json:"cmd"`
			Args  []string `json:"args"`
			Line  string   `json:"line"`
		}
		if err := ReadJSON(r, &body); err != nil {
			WriteJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		cmd := strings.TrimSpace(body.Cmd)
		args := body.Args
		if body.Line != "" && cmd == "" {
			parts := strings.Fields(body.Line)
			if len(parts) > 0 && parts[0] == group {
				parts = parts[1:]
			}
			if len(parts) > 0 {
				cmd = parts[0]
				args = parts[1:]
			}
		}
		if cmd == "" {
			cmd = "help"
		}
		res := a.Commands.Dispatch(group, cmd, args)
		status := 200
		if ok, _ := res["ok"].(bool); !ok {
			status = 400
		}
		WriteJSON(w, status, res)
	})

	for _, route := range exp.Routes {
		a.Handle(route.Method, route.Path, route.Handler)
	}

	a.apis = append(a.apis, map[string]any{
		"name": exp.Name, "description": exp.Description, "group": exp.Group,
		"routes_count": len(exp.Routes), "priority": exp.Priority,
	})
}

func (a *App) Handle(method, path string, h http.HandlerFunc) {
	a.routes[strings.ToUpper(method)+" "+path] = h
}

func (a *App) MountSystem() {
	a.Handle("GET", "/api/system/ping", func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, 200, map[string]any{"ok": true, "service": "goserver-core"})
	})
	a.Handle("GET", "/api/system/config", func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, 200, map[string]any{
			"server": map[string]any{
				"host": a.Config.Server.Host, "port": a.Config.Server.Port,
				"stdin": a.Config.Server.Stdin,
			},
			"runtime": "goserver",
		})
	})
	a.Handle("GET", "/api/system/groups", func(w http.ResponseWriter, r *http.Request) {
		out := a.Commands.ListHelp()
		out["ok"] = true
		WriteJSON(w, 200, out)
	})
	a.Handle("POST", "/api/system/command", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Line    string   `json:"line"`
			Group   string   `json:"group"`
			Command string   `json:"command"`
			Args    []string `json:"args"`
		}
		if err := ReadJSON(r, &body); err != nil {
			WriteJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		line := strings.TrimSpace(body.Line)
		if line == "" && body.Group != "" {
			line = body.Group + " " + body.Command
			for _, arg := range body.Args {
				line += " " + arg
			}
		}
		if line == "" {
			line = "help"
		}
		WriteJSON(w, 200, a.Commands.RunLine(line))
	})
	a.Handle("GET", "/", func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, 200, map[string]any{
			"name": "XRK-AGT Go 子服务端", "runtime": "goserver", "version": "1.0.0", "status": "running",
		})
	})
	a.Handle("GET", "/health", func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, 200, map[string]any{"status": "healthy", "runtime": "goserver"})
	})
	a.Handle("HEAD", "/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})
	a.Handle("GET", "/api/list", func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, 200, map[string]any{"apis": a.apis, "count": len(a.apis), "runtime": "goserver"})
	})
}

func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	key := r.Method + " " + r.URL.Path
	if h, ok := a.routes[key]; ok {
		h(w, r)
		return
	}
	WriteJSON(w, 404, map[string]any{"ok": false, "error": "Not Found"})
}

func (a *App) StartStdin() {
	if !a.Config.Server.Stdin.Enabled {
		return
	}
	fi, err := os.Stdin.Stat()
	if err != nil || (fi.Mode()&os.ModeCharDevice) == 0 {
		return
	}
	prompt := a.Config.Server.Stdin.Prompt
	if prompt == "" {
		prompt = "子服> "
	}
	go func() {
		fmt.Println("\n[子服] 终端命令已就绪 · 输入 帮助 或 list")
		sc := bufio.NewScanner(os.Stdin)
		for {
			fmt.Print(prompt)
			if !sc.Scan() {
				break
			}
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			if isExitLine(line) {
				fmt.Println("[子服] 终端已关闭（HTTP 继续运行）")
				break
			}
			out, _ := json.MarshalIndent(a.Commands.RunLine(line), "", "  ")
			fmt.Println(string(out))
		}
	}()
}
