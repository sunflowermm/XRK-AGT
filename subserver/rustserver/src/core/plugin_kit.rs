use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;

pub fn run_process(cmd: &str, args: &[&str], cwd: Option<&Path>) -> Value {
    match Command::new(cmd).args(args).current_dir(cwd.unwrap_or(Path::new("."))).output() {
        Ok(out) => json!({
            "ok": out.status.success(),
            "cmd": format!("{cmd} {}", args.join(" ")),
            "stdout": String::from_utf8_lossy(&out.stdout).trim(),
            "stderr": String::from_utf8_lossy(&out.stderr).trim(),
            "code": out.status.code(),
        }),
        Err(err) => json!({ "ok": false, "cmd": cmd, "error": err.to_string() }),
    }
}

pub fn git_pull(plugin_dir: &str) -> Value {
    let dir = Path::new(plugin_dir);
    if !dir.join(".git").exists() {
        return json!({ "ok": true, "skipped": "not a git repo" });
    }
    let mut step = run_process("git", &["pull", "--ff-only"], Some(dir));
    if let Some(obj) = step.as_object_mut() {
        obj.insert("action".into(), json!("git_pull"));
    }
    step
}

pub fn default_plugin_update(plugin_dir: &str) -> Value {
    let dir = Path::new(plugin_dir);
    let mut steps = vec![git_pull(plugin_dir)];

    if dir.join("Cargo.toml").exists() {
        steps.push(run_process("cargo", &["fetch"], Some(dir)));
    } else {
        steps.push(json!({ "ok": true, "skipped": "no Cargo.toml" }));
    }

    let ok = steps.iter().all(|s| s.get("ok") == Some(&json!(true)) || s.get("skipped").is_some());
    json!({
        "ok": ok,
        "plugin": dir.file_name().and_then(|s| s.to_str()).unwrap_or("rustserver"),
        "steps": steps,
    })
}
