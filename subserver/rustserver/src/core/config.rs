use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StdinConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_prompt")]
    pub prompt: String,
}

fn default_true() -> bool {
    true
}

fn default_prompt() -> String {
    "子服> ".into()
}

impl Default for StdinConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            prompt: default_prompt(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub stdin: StdinConfig,
}

fn default_host() -> String {
    "0.0.0.0".into()
}

fn default_port() -> u16 {
    8005
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            stdin: StdinConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RuntimeConfig {
    #[serde(default)]
    pub server: ServerConfig,
}

fn read_json(path: &Path) -> Option<RuntimeConfig> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

impl RuntimeConfig {
    pub fn load() -> Self {
        let default_path = PathBuf::from("config/default_config.json");
        let mut cfg = read_json(&default_path).unwrap_or_default();

        let data_dir = Self::data_dir();
        let runtime_path = data_dir.join("config.json");
        if let Some(user) = read_json(&runtime_path) {
            cfg.server.host = user.server.host;
            cfg.server.port = user.server.port;
            cfg.server.stdin = user.server.stdin;
        } else if default_path.is_file() {
            let _ = fs::create_dir_all(&data_dir);
            let _ = fs::copy(&default_path, &runtime_path);
        }

        if let Some(host) = env::var("HOST").ok().filter(|v| !v.is_empty()) {
            cfg.server.host = host;
        }
        if let Some(port) = env::var("PORT").ok().and_then(|v| v.parse().ok()) {
            cfg.server.port = port;
        }

        cfg
    }

    fn data_dir() -> PathBuf {
        for candidate in [
            PathBuf::from("../../data/rustserver"),
            PathBuf::from("data/rustserver"),
        ] {
            if candidate.parent().is_some_and(|p| p.exists()) || candidate.exists() {
                return candidate;
            }
        }
        PathBuf::from("../../data/rustserver")
    }
}
