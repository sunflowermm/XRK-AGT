# 导入路径迁移指南

## 概述

本文档说明 XRK-AGT 框架中导入路径的使用规则和迁移指南。

> **当前状态**：`core/*` 下模块（如 `system-Core`）均无独立 `package.json`，统一使用根包 `#` 别名。若将来新增带 `package.json` 的独立 Core 包，则需按「独立 Core 包」一节使用相对路径。

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

### 2. 独立 Core 包（如 `core/my-core` 且自带 `package.json`）

**自带 `package.json` 的 Core 包必须使用相对路径**，不能使用 `#` 别名。

**原因**：Node.js 的 `imports` 作用域限于当前包；跨包引用需用相对路径。

**路径规则**：
- 从 `core/my-core/*` 导入 `src/utils/*`：`../../../src/utils/*`
- 从 `core/my-core/*` 导入 `src/infrastructure/*`：`../../../src/infrastructure/*`

**示例**：

```javascript
// ✅ 正确：独立 Core 包中使用相对路径
import BotUtil from '../../../src/utils/botutil.js';
import StreamLoader from '../../../src/infrastructure/aistream/loader.js';
import { HttpResponse } from '../../../src/utils/http-utils.js';

// ❌ 错误：独立 Core 包中不能使用 # 别名
import BotUtil from '#utils/botutil.js';
```

### 3. 同一 Core 包内的导入

同一 Core 包内使用相对路径：

```javascript
// 在 core/my-core/plugin/my-plugin.js 中
import Other from './other.js';  // ✅ 正确
```

## 迁移检查清单

### 从 #imports 迁移到相对路径

1. **识别需要迁移的文件**
   - 仅限 **自带 `package.json`** 的 `core/*/` 目录（如 `core/my-core`）；`core/system-Core` 等无 `package.json` 的模块使用根包 `#` 别名，无需迁移
   - 检查是否有 `import ... from '#utils/...'` 或 `import ... from '#infrastructure/...'`

2. **计算相对路径**
   - 源文件：`core/my-core/http/my-api.js`
   - 目标：`src/utils/http-utils.js`
   - 路径：`../../../src/utils/http-utils.js`

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

### Q: 为什么自带 package.json 的 Core 不能使用 # 别名？

**A**: Node 按「最近 package.json」解析。`core/my-core/*` 下有 `package.json` 时，会先查该包；若未定义 `#utils/*` 等，会报 `ERR_PACKAGE_IMPORT_NOT_DEFINED`。

### Q: system-Core 为什么可以用根包的 # 别名？

**A**: `core/system-Core` **无** `package.json`，Node 向上查找，最终用根 `package.json` 的 `imports`。

### Q: 能否在独立 Core 的 package.json 里定义 imports 指向 src？

**A**: 不行。Node 的 `imports` **不允许** target 使用 `../../` 等跨包路径，故须用相对路径导入。

## 最佳实践

1. **项目根目录代码**：使用 `#imports` 别名，代码更简洁
2. **独立 Core 包**：使用相对路径，确保跨包引用正确
3. **同一包内**：使用相对路径，避免依赖包配置
4. **文档更新**：确保示例代码使用正确的导入方式

## 相关文件

- 根 `package.json`：定义 `#` 别名，供无独立 `package.json` 的 core（如 `system-Core`）使用
- `core/my-core/package.json`（可选）：独立 Core 包配置；有则须用相对路径导入 `src/*`
