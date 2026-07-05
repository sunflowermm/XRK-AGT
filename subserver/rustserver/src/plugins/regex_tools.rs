use axum::{routing::post, Json, Router};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::core::command_registry::CommandRegistry;
use crate::plugins::{cmd_handler, plugin_set};

pub fn register(registry: &CommandRegistry) {
    registry.register(plugin_set(
        "regex-tools",
        "regex-tools",
        "正则匹配与替换",
        "",
        vec![(
            "status",
            cmd_handler(|_| json!({ "service": "regex-tools", "runtime": "rust" })),
        )],
    ));
}

pub fn attach_routes<S>(router: Router<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    router
        .route("/api/regex-tools/match", post(r#match))
        .route("/api/regex-tools/replace", post(replace))
}

#[derive(Deserialize)]
struct TextBody {
    text: String,
    pattern: String,
    #[serde(default)]
    replacement: String,
}

async fn r#match(Json(body): Json<TextBody>) -> Json<Value> {
    if body.text.is_empty() || body.pattern.is_empty() {
        return Json(json!({ "ok": false, "error": "需要 text 与 pattern" }));
    }
    match Regex::new(&body.pattern) {
        Ok(re) => {
            let matches: Vec<String> = re
                .find_iter(&body.text)
                .map(|m| m.as_str().to_string())
                .collect();
            Json(json!({ "ok": true, "matches": matches, "count": matches.len() }))
        }
        Err(err) => Json(json!({ "ok": false, "error": err.to_string() })),
    }
}

async fn replace(Json(body): Json<TextBody>) -> Json<Value> {
    if body.text.is_empty() || body.pattern.is_empty() {
        return Json(json!({ "ok": false, "error": "需要 text 与 pattern" }));
    }
    match Regex::new(&body.pattern) {
        Ok(re) => {
            let out = re.replace_all(&body.text, body.replacement.as_str());
            Json(json!({ "ok": true, "result": out.to_string() }))
        }
        Err(err) => Json(json!({ "ok": false, "error": err.to_string() })),
    }
}
