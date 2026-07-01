mod core;
mod plugins;

use axum::Router;
use core::{app::AppState, config::RuntimeConfig, stdin::spawn_stdin};

#[tokio::main]
async fn main() {
    let cfg = RuntimeConfig::load();
    let state = AppState::new(&cfg);
    let app = Router::new().merge(state.routes());

    let addr = format!("{}:{}", cfg.server.host, cfg.server.port);
    println!("──────────────────────────────────────");
    println!("🌐 Rust 子服务  http://{addr}");
    println!("──────────────────────────────────────");

    spawn_stdin(state.registry.clone(), &cfg);

    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}
