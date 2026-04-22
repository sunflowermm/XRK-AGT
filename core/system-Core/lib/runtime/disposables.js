export class Disposables {
  /** @type {Array<() => void>} */
  #stack = [];

  add(disposeFn) {
    if (typeof disposeFn !== 'function') return;
    this.#stack.push(disposeFn);
  }

  interval(fn, ms) {
    const id = setInterval(fn, ms);
    this.add(() => clearInterval(id));
    return id;
  }

  timeout(fn, ms) {
    const id = setTimeout(fn, ms);
    this.add(() => clearTimeout(id));
    return id;
  }

  on(emitter, event, listener) {
    if (!emitter?.on || !emitter?.off) return;
    emitter.on(event, listener);
    this.add(() => {
      try { emitter.off(event, listener); } catch {}
    });
  }

  dispose() {
    const tasks = this.#stack.splice(0, this.#stack.length);
    for (let i = tasks.length - 1; i >= 0; i--) {
      try { tasks[i](); } catch {}
    }
  }
}

