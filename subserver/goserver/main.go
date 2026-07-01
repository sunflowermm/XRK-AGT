package main

import (
	"fmt"
	"net/http"
	"os"
	"strconv"

	"github.com/xrk-agt/goserver/core"

	_ "github.com/xrk-agt/goserver/apis/hash-tools"
)

func main() {
	cfg := core.LoadConfig()
	app := core.NewApp(cfg)
	core.LoadPlugins(app)
	app.MountSystem()

	host := cfg.Server.Host
	port := cfg.Server.Port
	if v := os.Getenv("HOST"); v != "" {
		host = v
	}
	if v := os.Getenv("PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			port = p
		}
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	fmt.Println("──────────────────────────────────────")
	fmt.Printf("🌐 Go 子服务  http://%s\n", addr)
	fmt.Println("──────────────────────────────────────")

	app.StartStdin()
	if err := http.ListenAndServe(addr, app); err != nil {
		panic(err)
	}
}
