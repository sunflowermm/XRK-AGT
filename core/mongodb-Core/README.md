# mongodb-Core

MongoDB 专业管理层 Core：集合注册、Repository、迁移、索引、Admin API。

## 职责边界

| 层 | 位置 | 职责 |
|----|------|------|
| Runtime | `src/infrastructure/mongodb.js` | 连接池、全局 `mongodbDb` |
| **mongodb-Core** | `core/mongodb-Core/` | 业务持久化规范与 API |
| 业务 Core | `core/<产品>/lib/store/` | 实体 Repository，调用 mongodb-Core |

Redis **不**在本 Core；运行时状态仍用 `src/infrastructure/redis.js`。

## 业务 Core 用法

```javascript
import { registerCollection, Repository } from '../../../mongodb-Core/lib/index.js';

const ORDERS = registerCollection('lsy', 'orders', {
  indexes: [{ key: { orderId: 1 }, unique: true }],
});

export class OrderRepo extends Repository {
  constructor() {
    super(ORDERS);
  }
}
```

或插件内使用全局：

```javascript
await MongoService.getCollection('lsy_orders').findOne({ orderId: 'x' });
```

## 配置

- 模板：`core/mongodb-Core/default/mongodb-core.yaml`
- 运行时：`data/mongodb-core/config.yaml`
- 控制台：CommonConfig → MongoDB-Core

## HTTP

| 路径 | 说明 |
|------|------|
| `GET /api/mongodb-core/health` | 连接与迁移状态 |
| `GET /api/mongodb-core/collections` | 已注册集合 |
| `GET /api/mongodb-core/admin/stats` | 集合文档数与索引数 |

## 迁移

脚本目录：`core/mongodb-Core/migrations/**/*.js`

```javascript
export default {
  id: '002_lsy_users',
  async up(db) {
    await db.collection('lsy_users').createIndex({ openId: 1 }, { unique: true });
  },
};
```

## 铁律

1. 禁止业务 Core 直接使用 `mongodbDb.collection()` — 走 `mongodb-Core/lib`
2. 集合必须 `registerCollection('<core>', '<entity>')`
3. 持久化进 Mongo；Redis 只做缓存/状态
