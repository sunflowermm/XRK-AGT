package core

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type ServerConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`
	Stdin struct {
		Enabled bool   `json:"enabled"`
		Prompt  string `json:"prompt"`
	} `json:"stdin"`
}

type Config struct {
	Server ServerConfig `json:"server"`
}

func LoadConfig() Config {
	dataDir := filepath.Join(RepoRoot(), "data", "goserver")
	_ = os.MkdirAll(dataDir, 0o755)
	runtime := filepath.Join(dataDir, "config.json")
	defaultFile := filepath.Join("config", "default_config.json")

	cfg := Config{}
	cfg.Server.Host = "0.0.0.0"
	cfg.Server.Port = 8001
	cfg.Server.Stdin.Enabled = true
	cfg.Server.Stdin.Prompt = "go> "

	if data, err := os.ReadFile(defaultFile); err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	if _, err := os.Stat(runtime); os.IsNotExist(err) {
		if data, err := os.ReadFile(defaultFile); err == nil {
			_ = os.WriteFile(runtime, data, 0o644)
		}
	}
	if data, err := os.ReadFile(runtime); err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8001
	}
	return cfg
}

func RepoRoot() string {
	wd, _ := os.Getwd()
	return filepath.Clean(filepath.Join(wd, "..", ".."))
}
