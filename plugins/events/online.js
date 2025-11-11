import EventListener from "../../lib/listener/listener.js";

/**
 * 监听上线事件
 */
export default class onlineEvent extends EventListener {
  constructor() {
    super({
      event: "online",
      once: true,
    });
    this.key = 'Yz:restart';
  }

  async execute() {
    Bot.makeLog("info", `尽情享受吧QaQ`, 'event');
  }
}