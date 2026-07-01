package core

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type CommandHandler func(args []string) map[string]any

type Route struct {
	Method  string
	Path    string
	Handler http.HandlerFunc
}

// PluginExport 对齐 pyserver default 字典
type PluginExport struct {
	Name        string
	Description string
	Group       string
	PluginDir   string
	Priority    int
	Commands    map[string]CommandHandler
	Routes      []Route
	OnUpdate    func() map[string]any
	Init        func()
}

func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func ReadJSON(r *http.Request, dest any) error {
	defer r.Body.Close()
	data, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil
	}
	return json.Unmarshal(data, dest)
}

type TextBody struct {
	Text string `json:"text"`
	Key  string `json:"key"`
}

func DefaultPluginUpdate(pluginDir string) map[string]any {
	steps := []map[string]any{}
	goMod := filepath.Join(pluginDir, "go.mod")
	if _, err := os.Stat(goMod); err == nil {
		cmd := exec.Command("go", "mod", "download")
		cmd.Dir = pluginDir
		out, err := cmd.CombinedOutput()
		steps = append(steps, map[string]any{
			"ok": err == nil, "action": "go_mod_download", "output": string(out),
		})
	} else {
		steps = append(steps, map[string]any{"ok": true, "skipped": "no go.mod"})
	}
	ok := true
	for _, s := range steps {
		if v, _ := s["ok"].(bool); !v {
			ok = false
		}
	}
	return map[string]any{"ok": ok, "plugin": filepath.Base(pluginDir), "steps": steps}
}
