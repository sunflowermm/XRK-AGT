use crate::core::command_registry::CommandRegistry;
use crate::core::config::RuntimeConfig;
use std::io::{self, IsTerminal, Write};
use std::sync::Arc;

pub fn spawn_stdin(registry: Arc<CommandRegistry>, cfg: &RuntimeConfig) {
    if !cfg.server.stdin.enabled || !io::stdin().is_terminal() {
        return;
    }

    let prompt = cfg.server.stdin.prompt.clone();
    tokio::task::spawn_blocking(move || {
        println!("\n[Rust 子服务] 终端命令已就绪 · 输入 help 或 list");
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
            if line == "exit" || line == "quit" {
                println!("[Rust 子服务] 终端命令已退出（HTTP 继续）");
                break;
            }
            let out = registry.run_line(line);
            println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
        }
    });
}
