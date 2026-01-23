/**
 * 最小堆实现
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


