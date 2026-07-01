use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::PathBuf;

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
    "rs> ".into()
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    #[serde(default)]
    pub server: ServerConfig,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                host: default_host(),
                port: default_port(),
                stdin: StdinConfig {
                    enabled: true,
                    prompt: default_prompt(),
                },
            },
        }
    }
}

impl RuntimeConfig {
    pub fn load() -> Self {
        let mut cfg = Self::default();
        let default_path = PathBuf::from("config/default_config.json");
        if default_path.is_file() {
            if let Ok(text) = fs::read_to_string(&default_path) {
                if let Ok(parsed) = serde_json::from_str::<RuntimeConfig>(&text) {
                    cfg = parsed;
                }
            }
        }

        let data_dir = Self::data_dir();
        let runtime_path = data_dir.join("config.json");
        if runtime_path.is_file() {
            if let Ok(text) = fs::read_to_string(&runtime_path) {
                if let Ok(user) = serde_json::from_str::<RuntimeConfig>(&text) {
                    cfg.server.host = user.server.host;
                    cfg.server.port = user.server.port;
                    cfg.server.stdin = user.server.stdin;
                }
            }
        } else if default_path.is_file() {
            let _ = fs::create_dir_all(&data_dir);
            let _ = fs::copy(&default_path, &runtime_path);
        }

        if let Ok(host) = env::var("HOST") {
            if !host.is_empty() {
                cfg.server.host = host;
            }
        }
        if let Ok(port) = env::var("PORT") {
            if let Ok(p) = port.parse() {
                cfg.server.port = p;
            }
        }

        cfg
    }

    fn data_dir() -> PathBuf {
        for candidate in [
            PathBuf::from("../../data/rustserver"),
            PathBuf::from("/app/data/rustserver"),
            PathBuf::from("data/rustserver"),
        ] {
            if candidate.parent().map(|p| p.exists()).unwrap_or(false) || candidate.exists() {
                return candidate;
            }
        }
        PathBuf::from("../../data/rustserver")
    }
}
