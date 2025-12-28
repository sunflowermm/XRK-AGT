/**
 * 最小堆实现
 * 用于高效管理工作流清理优先级
 * 基于堆排序算法，时间复杂度 O(log n)
 */
export class MinHeap {
  constructor(compareFn = (a, b) => a - b) {
    this.heap = [];
    this.compare = compareFn;
  }

  /**
   * 获取父节点索引
   */
  parent(index) {
    return Math.floor((index - 1) / 2);
  }

  /**
   * 获取左子节点索引
   */
  leftChild(index) {
    return 2 * index + 1;
  }

  /**
   * 获取右子节点索引
   */
  rightChild(index) {
    return 2 * index + 2;
  }

  /**
   * 交换两个节点
   */
  swap(i, j) {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }

  /**
   * 上浮操作（插入时）
   */
  heapifyUp(index) {
    if (index === 0) return;

    const parent = this.parent(index);
    if (this.compare(this.heap[index], this.heap[parent]) < 0) {
      this.swap(index, parent);
      this.heapifyUp(parent);
    }
  }

  /**
   * 下沉操作（删除时）
   */
  heapifyDown(index) {
    const left = this.leftChild(index);
    const right = this.rightChild(index);
    let smallest = index;

    if (left < this.heap.length && 
        this.compare(this.heap[left], this.heap[smallest]) < 0) {
      smallest = left;
    }

    if (right < this.heap.length && 
        this.compare(this.heap[right], this.heap[smallest]) < 0) {
      smallest = right;
    }

    if (smallest !== index) {
      this.swap(index, smallest);
      this.heapifyDown(smallest);
    }
  }

  /**
   * 插入元素
   */
  insert(value) {
    this.heap.push(value);
    this.heapifyUp(this.heap.length - 1);
  }

  /**
   * 获取并删除最小元素
   */
  extractMin() {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop();

    const min = this.heap[0];
    this.heap[0] = this.heap.pop();
    this.heapifyDown(0);
    return min;
  }

  /**
   * 获取最小元素（不删除）
   */
  peek() {
    return this.heap.length > 0 ? this.heap[0] : null;
  }

  /**
   * 检查堆是否为空
   */
  isEmpty() {
    return this.heap.length === 0;
  }

  /**
   * 获取堆大小
   */
  size() {
    return this.heap.length;
  }

  /**
   * 清空堆
   */
  clear() {
    this.heap = [];
  }

  /**
   * 查找元素索引
   */
  findIndex(predicate) {
    return this.heap.findIndex(predicate);
  }

  /**
   * 删除指定元素
   */
  remove(predicate) {
    const index = this.findIndex(predicate);
    if (index === -1) return false;

    if (index === this.heap.length - 1) {
      this.heap.pop();
      return true;
    }

    this.heap[index] = this.heap.pop();
    this.heapifyDown(index);
    this.heapifyUp(index);
    return true;
  }
}

/**
 * 工作流清理优先级管理器
 * 使用最小堆按清理时间排序，高效管理待清理的工作流
 */
export class WorkflowCleanupManager {
  constructor() {
    // 使用最小堆，按清理时间排序（最早的需要先清理）
    this.cleanupHeap = new MinHeap((a, b) => a.cleanupTime - b.cleanupTime);
    this.workflowMap = new Map(); // workflowId -> heap entry
  }

  /**
   * 添加工作流到清理队列
   * @param {string} workflowId - 工作流ID
   * @param {number} completedAt - 完成时间戳
   * @param {number} cleanupDelay - 清理延迟（毫秒）
   */
  scheduleCleanup(workflowId, completedAt, cleanupDelay = 30000) {
    const cleanupTime = completedAt + cleanupDelay;
    
    // 如果已存在，更新清理时间
    if (this.workflowMap.has(workflowId)) {
      this.remove(workflowId);
    }

    const entry = { workflowId, completedAt, cleanupTime };
    this.cleanupHeap.insert(entry);
    this.workflowMap.set(workflowId, entry);
  }

  /**
   * 从清理队列移除工作流
   */
  remove(workflowId) {
    const entry = this.workflowMap.get(workflowId);
    if (!entry) return false;

    this.workflowMap.delete(workflowId);
    return this.cleanupHeap.remove(e => e.workflowId === workflowId);
  }

  /**
   * 获取需要清理的工作流（已到清理时间）
   * @param {number} currentTime - 当前时间戳
   * @returns {Array<string>} 需要清理的工作流ID列表
   */
  getWorkflowsToCleanup(currentTime = Date.now()) {
    const toCleanup = [];

    while (!this.cleanupHeap.isEmpty()) {
      const entry = this.cleanupHeap.peek();
      
      // 如果最早的工作流还没到清理时间，停止
      if (entry.cleanupTime > currentTime) {
        break;
      }

      // 提取并记录
      const extracted = this.cleanupHeap.extractMin();
      if (extracted) {
        toCleanup.push(extracted.workflowId);
        this.workflowMap.delete(extracted.workflowId);
      }
    }

    return toCleanup;
  }

  /**
   * 获取下一个清理时间（用于定时器）
   */
  getNextCleanupTime(currentTime = Date.now()) {
    const entry = this.cleanupHeap.peek();
    if (!entry) return null;
    
    return Math.max(0, entry.cleanupTime - currentTime);
  }

  /**
   * 清空所有清理任务
   */
  clear() {
    this.cleanupHeap.clear();
    this.workflowMap.clear();
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      pendingCleanups: this.cleanupHeap.size(),
      nextCleanup: this.getNextCleanupTime()
    };
  }
}

