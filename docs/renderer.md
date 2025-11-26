## Renderer 文档（src/infrastructure/renderer/Renderer.js）

`Renderer` 是 XRK-AGT 中的 **渲染器基类**，用于统一：

- HTML 模板渲染。
- 静态资源路径处理。
- 模板文件监听与自动重载。

具体渲染实现（如 Puppeteer/Playwright 渲染图片）会基于此类封装生成 HTML，再交给浏览器引擎截图。

---

## 构造参数与属性

- 构造函数参数 `data`：
  - `id`：渲染器唯一标识（如 `puppeteer`、`playwright` 等）。
  - `type`：渲染类型（如 `'image'`、`'html'`）。
  - `render`：渲染入口方法名（默认 `'render'`）。

- 实例属性：
  - `this.id`：渲染器 ID。
  - `this.type`：渲染输出类型。
  - `this.render`：引用 `this[data.render || 'render']`，作为统一入口。
  - `this.dir = './temp/html'`：保存生成 HTML 的临时目录。
  - `this.html = {}`：模板内容缓存。
  - `this.watcher = {}`：文件监听器缓存。

构造函数会调用 `createDir(this.dir)` 确保基础目录存在。

---

## 模板处理：`dealTpl(name, data)`

用于从模板文件生成具体 HTML 文件，典型流程：

1. 从 `data` 中解构：
   - `tplFile`：模板文件路径（通常位于 `resources/` 下）。
   - `saveId`：保存文件名标识，默认为 `name`。
2. 计算输出路径：
   - `savePath = ./temp/html/${name}/${saveId}.html`。
3. 若 `this.html[tplFile]` 尚未缓存：
   - 调用 `createDir(./temp/html/${name})` 确保子目录存在。
   - 使用 `fs.readFileSync(tplFile, 'utf8')` 读取模板内容并缓存。
   - 调用 `watch(tplFile)` 监听模板变动。
4. 设置资源路径：
   - `data.resPath = ./resources/`，便于模板中引用静态资源。
5. 使用 `art-template` 渲染：
   - `template.render(this.html[tplFile], data)` 得到 HTML 字符串。
6. 将渲染结果写入 `savePath`，并返回该路径。

> 上层渲染器（如 Puppeteer 渲染器）通常会：
> - 调用 `dealTpl` 生成 HTML 文件。
> - 再用浏览器引擎打开该文件并截图，返回图片路径或 Buffer。

---

## 目录与文件监控

- `createDir(dirname)`：
  - 递归创建目录，类似 `mkdir -p` 的效果。
  - 若已存在则立即返回。

- `watch(tplFile)`：
  - 若已存在 watcher，直接返回。
  - 使用 `chokidar.watch(tplFile)` 监听模板文件。
  - 在 `change` 事件中：
    - 删除 `this.html[tplFile]` 缓存。
    - 打印日志 `[修改html模板] tplFile`。

> 当模板文件被修改后，下一次调用 `dealTpl` 会重新从磁盘读取最新模板并渲染，无需重启服务。

---

## 与具体渲染实现的关系

- `src/renderers/puppeteer` 与 `src/renderers/playwright` 中的渲染器会：
  - 继承 `Renderer`。
  - 在构造函数中调用 `super({ id, type, render: 'renderImage' })` 等。
  - 实现 `renderImage(data)`：
    - 使用 `dealTpl` 生成 HTML 文件。
    - 调用 Puppeteer/Playwright 打开该 HTML，并按需要截图。
    - 返回图片路径或 Buffer。

---

## 开发建议

- **新增渲染器**
  - 在 `src/renderers` 下新建子目录（如 `myrenderer`）。
  - 创建入口 JS 文件，定义一个继承自 `Renderer` 的类：
    - 在构造函数中设置 `id/type/render`。
    - 实现具体渲染逻辑（如调用第三方引擎生成图片或 PDF）。
  - 在相应 loader 中注册，使系统在启动时加载该渲染器。

- **模板组织**
  - 推荐将模板放在 `resources/` 下，以便统一管理与版本控制。
  - 若模板依赖静态资源（CSS/图片/字体等），使用 `data.resPath` 作为相对前缀。


