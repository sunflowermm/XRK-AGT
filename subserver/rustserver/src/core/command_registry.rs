use crate::core::plugin_kit;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

fn normalize_cli_line(line: &str) -> String {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.is_empty() {
        return line.trim().to_string();
    }
    let top = [("帮助", "help"), ("列表", "list"), ("组", "list")];
    let cmd = [("状态", "status"), ("更新", "update"), ("同步", "sync"), ("帮助", "help")];
    let mut out: Vec<String> = parts.iter().map(|s| s.to_string()).collect();
    for (from, to) in top {
        if out[0] == from {
            out[0] = to.into();
            break;
        }
    }
    if out.len() >= 2 {
        for (from, to) in cmd {
            if out[1] == from {
                out[1] = to.into();
                break;
            }
        }
    }
    out.join(" ")
}

pub fn is_exit_line(line: &str) -> bool {
    let t = line.trim();
    let lower = t.to_lowercase();
    matches!(lower.as_str(), "exit" | "quit" | "q") || matches!(t, "退出" | "离开")
}

pub type CommandHandler = Arc<dyn Fn(&[String]) -> Value + Send + Sync>;

pub struct PluginSet {
    pub group: String,
    pub name: String,
    pub description: String,
    pub plugin_dir: String,
    pub commands: BTreeMap<String, CommandHandler>,
}

pub struct CommandRegistry {
    groups: Mutex<BTreeMap<String, PluginSet>>,
}

impl CommandRegistry {
    pub fn new() -> Self {
        Self {
            groups: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn register(&self, set: PluginSet) {
        if set.group.is_empty() {
            return;
        }
        self.groups.lock().unwrap().insert(set.group.clone(), set);
    }

    pub fn groups(&self) -> Vec<String> {
        self.groups.lock().unwrap().keys().cloned().collect()
    }

    fn command_names(commands: &BTreeMap<String, CommandHandler>) -> Vec<String> {
        let mut names: Vec<String> = commands.keys().cloned().collect();
        if !names.iter().any(|x| x == "help") {
            names.push("help".into());
        }
        if !names.iter().any(|x| x == "update") {
            names.push("update".into());
        }
        names.sort();
        names
    }

    pub fn list_help(&self) -> Value {
        let groups = self.groups.lock().unwrap();
        let items: Vec<Value> = groups
            .values()
            .map(|g| {
                json!({
                    "group": g.group,
                    "description": g.description,
                    "commands": Self::command_names(&g.commands),
                })
            })
            .collect();
        json!({ "groups": items, "count": items.len() })
    }

    pub fn api_list(&self) -> Vec<Value> {
        let groups = self.groups.lock().unwrap();
        groups
            .values()
            .map(|g| {
                json!({
                    "name": g.name,
                    "description": g.description,
                    "group": g.group,
                })
            })
            .collect()
    }

    pub fn group_health(&self, group: &str) -> Value {
        let groups = self.groups.lock().unwrap();
        let Some(g) = groups.get(group) else {
            return json!({ "ok": false, "error": format!("未知插件组: {group}") });
        };
        json!({
            "ok": true,
            "group": g.group,
            "name": g.name,
            "commands": Self::command_names(&g.commands),
        })
    }

    pub fn dispatch(&self, group: &str, cmd: &str, args: &[String]) -> Value {
        let groups = self.groups.lock().unwrap();
        let Some(g) = groups.get(group) else {
            let available: Vec<String> = groups.keys().cloned().collect();
            return json!({
                "ok": false,
                "error": format!("未知插件组: {group}"),
                "available": available,
            });
        };

        let cmd = cmd.trim().to_lowercase();
        if cmd.is_empty() || cmd == "help" {
            return json!({
                "ok": true,
                "group": g.group,
                "commands": Self::command_names(&g.commands),
            });
        }

        if cmd == "update" {
            let result = if g.plugin_dir.is_empty() {
                plugin_kit::default_plugin_update(".")
            } else {
                plugin_kit::default_plugin_update(&g.plugin_dir)
            };
            return json!({ "ok": result["ok"], "group": g.group, "result": result });
        }

        if let Some(handler) = g.commands.get(&cmd) {
            let mut res = handler(args);
            if res.get("ok").is_none() {
                if let Some(obj) = res.as_object_mut() {
                    obj.insert("ok".into(), json!(true));
                }
            }
            if let Some(obj) = res.as_object_mut() {
                obj.insert("group".into(), json!(g.group));
            }
            return res;
        }

        json!({
            "ok": false,
            "error": format!("未知命令: {cmd}"),
            "group": g.group,
            "available": Self::command_names(&g.commands),
        })
    }

    pub fn run_line(&self, line: &str) -> Value {
        let line = normalize_cli_line(line);
        if line.is_empty() {
            return json!({ "ok": false, "error": "空命令" });
        }
        let lower = line.to_lowercase();
        if lower == "help" || lower == "?" {
            let mut out = self.list_help();
            if let Some(obj) = out.as_object_mut() {
                obj.insert("ok".into(), json!(true));
                obj.insert("hint".into(), json!("用法: <组名> <命令> [参数...]"));
            }
            return out;
        }
        if lower == "list" || lower == "groups" {
            return json!({ "ok": true, "groups": self.groups() });
        }

        let parts: Vec<String> = line.split_whitespace().map(String::from).collect();
        let group = parts[0].clone();
        let cmd = parts.get(1).cloned().unwrap_or_else(|| "help".into());
        let args = parts.into_iter().skip(2).collect::<Vec<_>>();
        self.dispatch(&group, &cmd, &args)
    }
}

impl Default for CommandRegistry {
    fn default() -> Self {
        Self::new()
    }
}
