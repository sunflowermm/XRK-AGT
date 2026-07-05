use crate::core::command_registry::{is_exit_line, CommandRegistry};
use crate::core::config::RuntimeConfig;
use std::io::{self, IsTerminal, Write};
use std::sync::Arc;

pub fn spawn_stdin(registry: Arc<CommandRegistry>, cfg: &RuntimeConfig) {
    if !cfg.server.stdin.enabled || !io::stdin().is_terminal() {
        return;
    }

    let prompt = cfg.server.stdin.prompt.clone();
    tokio::task::spawn_blocking(move || {
        println!("\n[子服] 终端命令已就绪 · 输入 帮助 或 list");
        loop {
            print!("{prompt}");
            let _ = io::stdout().flush();
            let mut line = String::new();
            if io::stdin().read_line(&mut line).is_err() {
                break;
            }
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if is_exit_line(line) {
                println!("[子服] 终端已关闭（HTTP 继续运行）");
                break;
            }
            let out = registry.run_line(line);
            println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
        }
    });
}
