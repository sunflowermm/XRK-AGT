## ConfigBase 文档（src/infrastructure/commonconfig/commonconfig.js）

`ConfigBase` 是 XRK-AGT 的 **配置管理基类**，用于统一处理：

- YAML/JSON 配置文件的读写。
- 配置缓存与备份。
- 路径解析（支持动态路径）。
- 基于 schema 的基础验证。
- 按路径读写（支持对象与数组）。

具体的配置类型（如 server 配置、设备配置等）会继承此类，并在 `core/commonconfig` 或其它位置定义。

---

## 构造参数与属性

构造函数接收一个 `metadata` 对象，常用字段：

- `name`：配置名称（用于标识与日志）。
- `displayName`：用于 UI 显示的友好名称。
- `description`：配置说明。
- `filePath`：
  - 字符串：相对于项目根目录 `paths.root` 的路径，如 `config/server.yaml`。
  - 函数：动态路径函数 `(cfg) => 'config/server_8086.yaml'`。
- `fileType`：`'yaml'` 或 `'json'`（默认为 `'yaml'`）。
- `schema`：简单结构定义，用于基础验证。

内部字段：

| 属性 | 类型 | 说明 |
|------|------|------|
| `fullPath` | `string` | 当 `filePath` 为字符串时预先计算的完整路径 |
| `_cache` | `any` | 最近一次读取的配置对象缓存 |
| `_cacheTime` | `number` | 缓存时间戳，用于判断是否过期 |
| `_cacheTTL` | `number` | 缓存有效期（毫秒），默认 5000 |

---

## 路径解析

```mermaid
flowchart LR
    Start[ConfigBase 实例] --> Resolve[_resolveFilePath]
    Resolve -->|filePath 是函数| Dyn[调用 _getFilePath(cfg)<br/>基于 global.cfg/环境变量生成路径]
    Resolve -->|filePath 是字符串| FullPath[直接使用 fullPath]
    Resolve -->|都未设置| Default[path.join(paths.config, 'config/<name>.yaml')]
    Dyn --> JoinRoot[paths.root + 相对路径]
    FullPath --> Done[返回绝对路径]
    Default --> Done
    JoinRoot --> Done
```

- `_resolveFilePath()`：
  - 若 `filePath` 是函数，则：
    - 使用 `global.cfg` 或环境变量中的端口信息构造一个 cfg 对象。
    - 调用 `_getFilePath(cfg)` 得到相对路径，再拼接 `paths.root`。
  - 若 `fullPath` 已存在，则直接返回。
  - 否则使用默认约定：`paths.config/config/${name}.yaml`。

- `getFilePath()`：对外暴露的路径获取方法，内部调用 `_resolveFilePath()`。

---

## 读取与写入

| 方法 | 签名 | 说明 |
|------|------|------|
| `exists()` | `Promise<boolean>` | 异步检查配置文件是否存在 |
| `read(useCache = true)` | `Promise<object>` | 从磁盘（或缓存）读取配置，自动按 `fileType` 解析为对象 |
| `write(data, options?)` | `Promise<boolean>` | 写入配置到磁盘，可选备份与校验 |
| `backup()` | `Promise<string>` | 将当前配置复制为带时间戳的备份文件，并返回备份路径 |

读取流程要点：

- 启用缓存时，`_cacheTTL` 内重复调用 `read(true)` 不会命中磁盘，适合高频读取的配置。  
- 当文件不存在时，`read` 会抛出错误，调用方应捕获并决定是否使用默认配置或先写入一份模板。

写入流程要点：

1. 若 `validate` 为 `true`，先调用 `validate(data)`；失败会抛出详细错误（包含错误数组）。  
2. 若 `backup` 为 `true` 且文件存在，则自动调用 `backup()` 在同目录下生成 `.backup.<时间戳>` 文件。  
3. 根据 `fileType` 序列化为 YAML 或 JSON，并保证使用统一缩进与行宽，方便人工修改与版本控制。  
4. 更新内存缓存，使后续 `read` 可立即读取到最新值。

---

## 按路径读写（点号与数组索引）

`ConfigBase` 提供了基于「点号路径 + 数组索引」的读写接口：

- `get(keyPath)`：
  - 先 `read()` 获取完整配置对象。
  - 通过 `_getValueByPath(obj, keyPath)` 按路径取值。
  - 支持：
    - `server.host`
    - `server.proxy.domains[0].domain`

- `set(keyPath, value, options)`：
  - 读取数据后使用 `_setValueByPath` 写入，再调用 `write` 持久化。

- `delete(keyPath, options)`：
  - `_deleteValueByPath` 删除路径对应的值，然后 `write`。

- `append(keyPath, value, options)`：
  - 确认路径对应值为数组，将新值 `push` 进去并写回。

- `remove(keyPath, indexOrPredicate, options)`：
  - 从数组中按索引或条件函数移除元素。

> 这些方法适合用于动态修改配置（如添加反向代理域名、调整白名单路径等），同时保留原文件格式。

---

## 合并与重置

- `merge(newData, { deep = true, backup = true, validate = true } = {})`：
  - 读取当前配置数据。
  - 若 `deep` 为 `true`，使用 `_deepMerge` 进行深度合并。
  - 否则进行浅拷贝合并。
  - 最后调用 `write`。

- `reset(options)`：
  - 若子类定义了 `this.defaultConfig`，可将配置重置为默认值。

- `clearCache()`：
  - 清空内存缓存，强制下次 `read()` 时重新从磁盘读取。

---

## 验证逻辑：`validate(data)`

提供了轻量、可扩展的校验机制：

- 支持检测：
  - 必需字段：`schema.required`。
  - 类型：`schema.fields[field].type`（string/number/boolean/array/object）。
  - 数值范围：`min/max`。
  - 字符串长度：`minLength/maxLength`。
  - 正则模式：`pattern`。
  - 枚举值：`enum`。
- 对于 null/undefined 值，会结合 `nullable` 字段决定是否允许。
- 若子类定义了 `customValidate(data)`，则会追加执行自定义验证。
- 返回 `{ valid, errors }` 结构。

---

## 与系统其它部分的关系

- `paths`：通过 `paths.root/paths.config` 等提供基础路径信息。
- `commonconfig` 模块：在 `src/infrastructure/commonconfig/` 中将不同配置类型封装为具体子类，并在系统启动时通过 `ConfigLoader` 加载与注册。
- `Bot`：
  - 在 `Bot.run()` 中，配置数据会被加载并挂到全局，如 `global.cfg`。
  - `ConfigBase` 动态路径计算函数可以借助 `cfg` 决定文件位置，例如基于端口生成不同配置文件。

---

## 使用示例（子类）

```js
// 示例：定义一个 server 配置类
import ConfigBase from '#infrastructure/commonconfig/commonconfig.js';

export default class ServerConfig extends ConfigBase {
  constructor() {
    super({
      name: 'server',
      displayName: '服务器配置',
      description: 'HTTP/HTTPS 端口、域名、代理、CORS 等',
      filePath: 'config/server.yaml',
      fileType: 'yaml',
      schema: {
        required: ['server'],
        fields: {
          server: { type: 'object' },
          'server.port': { type: 'number', min: 1, max: 65535 }
        }
      }
    });
  }
}
```

实际使用时，可通过 `ConfigLoader` 提供的统一接口读取与修改该配置。


