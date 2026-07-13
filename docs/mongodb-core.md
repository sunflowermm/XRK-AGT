# MongoDB-Core

> 业务持久化层 Core · 连接仍在 Runtime（`src/infrastructure/mongodb.js`）

## 文档

- Core README：[`core/mongodb-Core/README.md`](../core/mongodb-Core/README.md)
- 连接与 Redis：[`database.md`](database.md)

## 架构

```
Runtime (src/)          → 建连 mongodbDb / redis
mongodb-Core (core/)    → registerCollection、Repository、迁移、Admin API
业务 Core (lsy/jm/…)    → import mongodb-Core/lib，禁止 mongodbDb.collection()
```

## 快速接入

```javascript
import { registerCollection, Repository } from '../../../mongodb-Core/lib/index.js';

const USERS = registerCollection('myapp', 'users', {
  indexes: [{ key: { email: 1 }, unique: true }],
});

export class UserRepo extends Repository {
  constructor() {
    super(USERS);
  }
}
```

## Admin

- `GET /api/mongodb-core/health`
- `GET /api/mongodb-core/collections`
- `GET /api/mongodb-core/admin/stats`

## 配置

`data/mongodb-core/config.yaml`（模板 `core/mongodb-Core/default/mongodb-core.yaml`）
