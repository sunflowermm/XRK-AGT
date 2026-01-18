# 导入路径迁移指南

## 概述

本文档说明 XRK-AGT 框架中导入路径的使用规则和迁移指南。

## 导入路径规则

### 1. 项目根目录（主包）

项目根目录的代码可以使用 `package.json` 中定义的 `imports` 别名：

```javascript
// ✅ 正确：在项目根目录的代码中
import BotUtil from '#utils/botutil.js';
import StreamLoader from '#infrastructure/aistream/loader.js';
```

**可用别名**（定义在根 `package.json`）：
- `#utils/*` → `./src/utils/*`
- `#infrastructure/*` → `./src/infrastructure/*`
- `#core/*` → `./core/*`
- `#config/*` → `./config/*`
- `#data/*` → `./data/*`
- `#renderers/*` → `./src/renderers/*`
- `#modules/*` → `./src/modules/*`
- `#factory/*` → `./src/factory/*`

### 2. 独立 Core 包（如 Example-Core）

**独立 Core 包必须使用相对路径**，不能使用 `#imports` 别名。

**原因**：
- Node.js 的 `imports` 字段作用域限制在当前 `package.json` 所在的包内
- 每个 Core 包有自己的 `package.json`，形成独立的包作用域
- 跨包引用需要使用相对路径

**路径规则**：
- 从 `core/Example-Core/*` 导入 `src/utils/*`：`../../../src/utils/*`
- 从 `core/Example-Core/*` 导入 `src/infrastructure/*`：`../../../src/infrastructure/*`

**示例**：

```javascript
// ✅ 正确：Example-Core 中使用相对路径
import BotUtil from '../../../src/utils/botutil.js';
import StreamLoader from '../../../src/infrastructure/aistream/loader.js';
import { HttpResponse } from '../../../src/utils/http-utils.js';

// ❌ 错误：Example-Core 中不能使用 #imports
import BotUtil from '#utils/botutil.js';
import StreamLoader from '#infrastructure/aistream/loader.js';
```

### 3. 同一 Core 包内的导入

同一 Core 包内的文件可以使用相对路径：

```javascript
// 在 core/Example-Core/plugin/example-workflow.js 中
import ExampleTimer from './example-timer.js';  // ✅ 正确
```

## 迁移检查清单

### 从 #imports 迁移到相对路径

1. **识别需要迁移的文件**
   - 所有 `core/*/` 目录下的文件（除了 `core/system-Core`，它没有自己的 package.json）
   - 检查文件中是否有 `import ... from '#utils/...'` 或 `import ... from '#infrastructure/...'`

2. **计算相对路径**
   - 确定源文件位置：`core/Example-Core/http/example-api.js`
   - 确定目标位置：`src/utils/http-utils.js`
   - 计算路径：`../../../src/utils/http-utils.js`

3. **更新导入语句**
   ```javascript
   // 之前
   import { HttpResponse } from '#utils/http-utils.js';
   
   // 之后
   import { HttpResponse } from '../../../src/utils/http-utils.js';
   ```

4. **验证**
   - 运行 `node app` 确保没有模块解析错误
   - 检查控制台是否有 `ERR_PACKAGE_IMPORT_NOT_DEFINED` 或 `Cannot find module` 错误

## 常见问题

### Q: 为什么 Example-Core 不能使用 #imports？

**A**: Node.js 的 `imports` 字段遵循"最近的 package.json 优先"规则。当 Node 解析 `core/Example-Core/http/example-api.js` 中的 `#utils/...` 时，会先找到 `core/Example-Core/package.json`，如果这个文件没有定义 `#utils/*`，就会报错 `ERR_PACKAGE_IMPORT_NOT_DEFINED`。

### Q: system-Core 为什么可以使用根 package.json 的 imports？

**A**: `core/system-Core` 目录下**没有**自己的 `package.json`，所以 Node 会继续向上查找，最终使用根目录的 `package.json` 中的 `imports` 配置。

### Q: 能否在 Example-Core 的 package.json 中定义 imports？

**A**: 理论上可以，但 Node.js 的 `imports` 字段**不允许** target 使用 `../../` 这样的跨包路径。例如：
```json
{
  "imports": {
    "#utils/*": "../../src/utils/*"  // ❌ 无效：Invalid package target
  }
}
```
所以必须使用相对路径导入。

## 最佳实践

1. **项目根目录代码**：使用 `#imports` 别名，代码更简洁
2. **独立 Core 包**：使用相对路径，确保跨包引用正确
3. **同一包内**：使用相对路径，避免依赖包配置
4. **文档更新**：确保示例代码使用正确的导入方式

## 相关文件

- `package.json` - 根包配置，定义 `#imports` 别名
- `core/Example-Core/package.json` - Example-Core 包配置（不包含 imports）
- `core/system-Core/` - 没有 package.json，使用根包的 imports
