use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::Arc;

use super::command_registry::CommandRegistry;
use super::config::RuntimeConfig;
use crate::plugins;

pub struct AppState {
    pub registry: Arc<CommandRegistry>,
    pub config: RuntimeConfig,
}

impl AppState {
    pub fn new(config: &RuntimeConfig) -> Self {
        let registry = Arc::new(CommandRegistry::new());
        plugins::register_all(&registry);
        Self {
            registry,
            config: config.clone(),
        }
    }

    pub fn routes(self) -> Router {
        let state = Arc::new(self);
        Router::new()
            .route("/", get(root))
            .route("/health", get(health).head(health_head))
            .route("/api/list", get(api_list))
            .route("/api/system/ping", get(system_ping))
            .route("/api/system/config", get(system_config))
            .route("/api/system/groups", get(system_groups))
            .route("/api/system/command", post(system_command))
            .route("/api/:group/health", get(group_health))
            .route("/api/:group/command", post(group_command))
            .merge(plugins::routes(state.registry.clone()))
            .with_state(state)
    }
}

async fn root() -> Json<Value> {
    Json(json!({
        "name": "XRK-AGT Rust 子服务端",
        "runtime": "rustserver",
        "version": "1.0.0",
        "status": "running",
    }))
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "healthy", "runtime": "rustserver" }))
}

async fn health_head() -> StatusCode {
    StatusCode::OK
}

async fn api_list(State(state): State<Arc<AppState>>) -> Json<Value> {
    let apis = state.registry.api_list();
    Json(json!({ "apis": apis, "count": apis.len(), "runtime": "rustserver" }))
}

async fn system_ping() -> Json<Value> {
    Json(json!({ "ok": true, "service": "rustserver-core" }))
}

async fn system_config(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({
        "runtime": "rustserver",
        "server": {
            "host": state.config.server.host,
            "port": state.config.server.port,
            "stdin": state.config.server.stdin,
        },
    }))
}

async fn system_groups(State(state): State<Arc<AppState>>) -> Json<Value> {
    let mut out = state.registry.list_help();
    if let Some(obj) = out.as_object_mut() {
        obj.insert("ok".into(), json!(true));
    }
    Json(out)
}

async fn system_command(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut line = body
        .get("line")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if line.is_empty() {
        if let Some(group) = body.get("group").and_then(|v| v.as_str()) {
            let cmd = body.get("command").and_then(|v| v.as_str()).unwrap_or("help");
            line = format!("{group} {cmd}");
            if let Some(args) = body.get("args").and_then(|v| v.as_array()) {
                for arg in args {
                    if let Some(s) = arg.as_str() {
                        line.push(' ');
                        line.push_str(s);
                    }
                }
            }
        }
    }

    if line.is_empty() {
        line = "help".into();
    }

    Json(state.registry.run_line(&line))
}

async fn group_health(
    State(state): State<Arc<AppState>>,
    Path(group): Path<String>,
) -> Json<Value> {
    Json(state.registry.group_health(&group))
}

async fn group_command(
    State(state): State<Arc<AppState>>,
    Path(group): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let mut cmd = body
        .get("cmd")
        .or_else(|| body.get("command"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut args: Vec<String> = body
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    if let Some(line) = body.get("line").and_then(|v| v.as_str()) {
        if cmd.is_empty() && !line.trim().is_empty() {
            let mut parts = line.split_whitespace();
            if parts.next().as_deref() == Some(group.as_str()) {
                cmd = parts.next().unwrap_or("help").into();
                args = parts.map(String::from).collect();
            }
        }
    }

    if cmd.is_empty() {
        cmd = "help".into();
    }

    let result = state.registry.dispatch(&group, &cmd, &args);
    let status = if result.get("ok") == Some(&json!(false)) {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::OK
    };
    (status, Json(result)).into_response()
}
