package hashtools

import (
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"path/filepath"

	"github.com/xrk-agt/goserver/core"
)

func init() {
	dir, _ := filepath.Abs(filepath.Join("apis", "hash-tools"))
	core.RegisterPlugin(core.PluginExport{
		Name:        "hash-tools",
		Description: "SHA256 / MD5 / Base64 / HMAC",
		Group:       "hash-tools",
		PluginDir:   dir,
		Priority:    150,
		Commands: map[string]core.CommandHandler{
			"status": func(_ []string) map[string]any {
				return map[string]any{"service": "hash-tools", "runtime": "go"}
			},
		},
		Routes: []core.Route{
			{Method: "POST", Path: "/api/hash-tools/sha256", Handler: sha256Handler},
			{Method: "POST", Path: "/api/hash-tools/md5", Handler: md5Handler},
			{Method: "POST", Path: "/api/hash-tools/base64-encode", Handler: b64EncHandler},
			{Method: "POST", Path: "/api/hash-tools/base64-decode", Handler: b64DecHandler},
			{Method: "POST", Path: "/api/hash-tools/hmac", Handler: hmacHandler},
		},
	})
}

func sha256Handler(w http.ResponseWriter, r *http.Request) {
	var body core.TextBody
	if err := core.ReadJSON(r, &body); err != nil || body.Text == "" {
		core.WriteJSON(w, 400, map[string]any{"ok": false, "error": "需要 text"})
		return
	}
	sum := sha256.Sum256([]byte(body.Text))
	core.WriteJSON(w, 200, map[string]any{"ok": true, "hash": hex.EncodeToString(sum[:])})
}

func md5Handler(w http.ResponseWriter, r *http.Request) {
	var body core.TextBody
	if err := core.ReadJSON(r, &body); err != nil || body.Text == "" {
		core.WriteJSON(w, 400, map[string]any{"ok": false, "error": "需要 text"})
		return
	}
	sum := md5.Sum([]byte(body.Text))
	core.WriteJSON(w, 200, map[string]any{"ok": true, "hash": hex.EncodeToString(sum[:])})
}

func b64EncHandler(w http.ResponseWriter, r *http.Request) {
	var body core.TextBody
	if err := core.ReadJSON(r, &body); err != nil {
		core.WriteJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	core.WriteJSON(w, 200, map[string]any{
		"ok": true, "encoded": base64.StdEncoding.EncodeToString([]byte(body.Text)),
	})
}

func b64DecHandler(w http.ResponseWriter, r *http.Request) {
	var body core.TextBody
	if err := core.ReadJSON(r, &body); err != nil || body.Text == "" {
		core.WriteJSON(w, 400, map[string]any{"ok": false, "error": "需要 text"})
		return
	}
	dec, err := base64.StdEncoding.DecodeString(body.Text)
	if err != nil {
		core.WriteJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	core.WriteJSON(w, 200, map[string]any{"ok": true, "decoded": string(dec)})
}

func hmacHandler(w http.ResponseWriter, r *http.Request) {
	var body core.TextBody
	if err := core.ReadJSON(r, &body); err != nil || body.Text == "" || body.Key == "" {
		core.WriteJSON(w, 400, map[string]any{"ok": false, "error": "需要 text 与 key"})
		return
	}
	m := hmac.New(sha256.New, []byte(body.Key))
	m.Write([]byte(body.Text))
	core.WriteJSON(w, 200, map[string]any{"ok": true, "hmac": hex.EncodeToString(m.Sum(nil))})
}
