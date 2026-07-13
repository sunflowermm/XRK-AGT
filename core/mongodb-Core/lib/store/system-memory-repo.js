import { Repository, registerCollection } from '../index.js';

const MEMORY = registerCollection('system', 'memory');

/** system-Core Agent memory 持久化（供后续从 JSON 迁移） */
export class SystemMemoryRepo extends Repository {
  constructor() {
    super(MEMORY);
  }

  async get(workspaceId, key) {
    return this.findOne({ workspaceId, key });
  }

  async set(workspaceId, key, value, meta = {}) {
    const now = new Date();
    return this.updateOne(
      { workspaceId, key },
      {
        $set: { value, meta, updatedAt: now },
        $setOnInsert: { workspaceId, key, createdAt: now },
      },
      { upsert: true },
    );
  }

  async listByWorkspace(workspaceId) {
    return this.find({ workspaceId }).toArray();
  }

  async remove(workspaceId, key) {
    return this.deleteOne({ workspaceId, key });
  }
}
