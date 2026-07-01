package core

var pendingPlugins []PluginExport

// RegisterPlugin 由 apis/*/service.go 的 init 调用，LoadPlugins 时装载到 App
func RegisterPlugin(exp PluginExport) {
	pendingPlugins = append(pendingPlugins, exp)
}

// LoadPlugins 将 init 阶段登记的插件挂到 App（main 在 NewApp 后调用）
func LoadPlugins(app *App) {
	for _, exp := range pendingPlugins {
		app.RegisterPlugin(exp)
	}
}
