package core

import (
	"sort"
	"strings"
)

type PluginCommandSet struct {
	Group       string
	Description string
	PluginDir   string
	Commands    map[string]CommandHandler
	OnUpdate    func() map[string]any
}

type CommandRegistry struct {
	groups map[string]*PluginCommandSet
}

func NewCommandRegistry() *CommandRegistry {
	return &CommandRegistry{groups: map[string]*PluginCommandSet{}}
}

func (cr *CommandRegistry) Register(exp PluginExport) {
	if exp.Group == "" || (len(exp.Commands) == 0 && exp.PluginDir == "") {
		return
	}
	cr.groups[exp.Group] = &PluginCommandSet{
		Group:       exp.Group,
		Description: exp.Description,
		PluginDir:   exp.PluginDir,
		Commands:    exp.Commands,
		OnUpdate:    exp.OnUpdate,
	}
}

func (cr *CommandRegistry) Groups() []string {
	out := make([]string, 0, len(cr.groups))
	for k := range cr.groups {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func commandNames(m map[string]CommandHandler) []string {
	set := map[string]struct{}{"help": {}, "update": {}}
	for k := range m {
		set[k] = struct{}{}
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func (cr *CommandRegistry) ListHelp() map[string]any {
	items := []map[string]any{}
	for _, name := range cr.Groups() {
		g := cr.groups[name]
		items = append(items, map[string]any{
			"group": name, "description": g.Description, "commands": commandNames(g.Commands),
		})
	}
	return map[string]any{"groups": items, "count": len(items)}
}

func (cr *CommandRegistry) Dispatch(group, cmd string, args []string) map[string]any {
	g, ok := cr.groups[group]
	if !ok {
		return map[string]any{"ok": false, "error": "未知插件组: " + group, "available": cr.Groups()}
	}
	cmd = strings.ToLower(strings.TrimSpace(cmd))
	if cmd == "" || cmd == "help" {
		return map[string]any{"ok": true, "group": group, "commands": commandNames(g.Commands)}
	}
	if cmd == "update" {
		var result map[string]any
		if g.OnUpdate != nil {
			result = g.OnUpdate()
		} else {
			result = DefaultPluginUpdate(g.PluginDir)
		}
		return map[string]any{"ok": result["ok"], "group": group, "result": result}
	}
	if h, ok := g.Commands[cmd]; ok {
		res := h(args)
		if res == nil {
			res = map[string]any{}
		}
		res["ok"] = true
		res["group"] = group
		return res
	}
	return map[string]any{
		"ok": false, "error": "未知命令: " + cmd, "group": group,
		"available": commandNames(g.Commands),
	}
}

func (cr *CommandRegistry) RunLine(line string) map[string]any {
	line = strings.TrimSpace(line)
	if line == "" {
		return map[string]any{"ok": false, "error": "空命令"}
	}
	lower := strings.ToLower(line)
	if lower == "help" || lower == "?" {
		out := cr.ListHelp()
		out["ok"] = true
		out["hint"] = "用法: <组名> <命令> [参数...]"
		return out
	}
	if lower == "list" || lower == "groups" {
		return map[string]any{"ok": true, "groups": cr.Groups()}
	}
	parts := strings.Fields(line)
	group := parts[0]
	cmd := "help"
	args := []string{}
	if len(parts) > 1 {
		cmd = parts[1]
		args = parts[2:]
	}
	return cr.Dispatch(group, cmd, args)
}
