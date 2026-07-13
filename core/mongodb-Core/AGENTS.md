# MongoDB-Core — 产品 Agent 规则

- 业务数据持久化**必须**通过 `MongoService` 或 `import ... from mongodb-Core/lib/index.js`
- 新建实体前在代码里 `registerCollection('<你的core名>', '<实体>')`
- 不要自造集合名；格式固定为 `<core>_<entity>`
- 临时状态、计数、锁用 Redis（全局 `redis`），不要写 Mongo
