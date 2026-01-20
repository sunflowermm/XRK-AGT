/**
 * Agent Manager - Agent生命周期管理
 * 负责Agent的创建、启动、暂停、恢复、销毁等生命周期管理
 */
import BotUtil from '#utils/botutil.js';
import EventEmitter from 'events';

export class AgentManager extends EventEmitter {
  constructor() {
    super();
    this.agents = new Map(); // agentId -> Agent实例
    this.agentStates = new Map(); // agentId -> 状态信息
    this.agentConfigs = new Map(); // agentId -> 配置信息
  }

  /**
   * 创建Agent
   * @param {string} agentId - Agent唯一标识
   * @param {Object} config - Agent配置
   * @param {string} config.workflow - 工作流名称
   * @param {Object} config.context - 初始上下文
   * @param {number} config.priority - 优先级
   * @returns {Agent} Agent实例
   */
  createAgent(agentId, config = {}) {
    if (this.agents.has(agentId)) {
      throw new Error(`Agent ${agentId} 已存在`);
    }

    const agent = {
      id: agentId,
      workflow: config.workflow || 'chat',
      context: config.context || {},
      priority: config.priority || 100,
      state: 'created',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stats: {
        messagesProcessed: 0,
        toolsCalled: 0,
        errors: 0
      }
    };

    this.agents.set(agentId, agent);
    this.agentStates.set(agentId, 'created');
    this.agentConfigs.set(agentId, config);

    this.emit('agent:created', { agentId, agent });
    BotUtil.makeLog('info', `Agent创建: ${agentId}`, 'AgentManager');

    return agent;
  }

  /**
   * 启动Agent
   * @param {string} agentId - Agent ID
   */
  async startAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} 不存在`);
    }

    if (agent.state === 'running') {
      BotUtil.makeLog('warn', `Agent ${agentId} 已在运行`, 'AgentManager');
      return;
    }

    agent.state = 'running';
    agent.updatedAt = Date.now();
    this.agentStates.set(agentId, 'running');

    this.emit('agent:started', { agentId, agent });
    BotUtil.makeLog('info', `Agent启动: ${agentId}`, 'AgentManager');
  }

  /**
   * 暂停Agent
   * @param {string} agentId - Agent ID
   */
  pauseAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} 不存在`);
    }

    if (agent.state !== 'running') {
      BotUtil.makeLog('warn', `Agent ${agentId} 未在运行`, 'AgentManager');
      return;
    }

    agent.state = 'paused';
    agent.updatedAt = Date.now();
    this.agentStates.set(agentId, 'paused');

    this.emit('agent:paused', { agentId, agent });
    BotUtil.makeLog('info', `Agent暂停: ${agentId}`, 'AgentManager');
  }

  /**
   * 恢复Agent
   * @param {string} agentId - Agent ID
   */
  async resumeAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} 不存在`);
    }

    if (agent.state !== 'paused') {
      BotUtil.makeLog('warn', `Agent ${agentId} 未暂停`, 'AgentManager');
      return;
    }

    agent.state = 'running';
    agent.updatedAt = Date.now();
    this.agentStates.set(agentId, 'running');

    this.emit('agent:resumed', { agentId, agent });
    BotUtil.makeLog('info', `Agent恢复: ${agentId}`, 'AgentManager');
  }

  /**
   * 销毁Agent
   * @param {string} agentId - Agent ID
   */
  destroyAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    agent.state = 'destroyed';
    agent.updatedAt = Date.now();

    this.agents.delete(agentId);
    this.agentStates.delete(agentId);
    this.agentConfigs.delete(agentId);

    this.emit('agent:destroyed', { agentId, agent });
    BotUtil.makeLog('info', `Agent销毁: ${agentId}`, 'AgentManager');
  }

  /**
   * 获取Agent
   * @param {string} agentId - Agent ID
   * @returns {Agent|null}
   */
  getAgent(agentId) {
    return this.agents.get(agentId) || null;
  }

  /**
   * 获取所有Agent
   * @returns {Array}
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * 获取Agent状态
   * @param {string} agentId - Agent ID
   * @returns {string|null}
   */
  getAgentState(agentId) {
    return this.agentStates.get(agentId) || null;
  }

  /**
   * 更新Agent统计信息
   * @param {string} agentId - Agent ID
   * @param {Object} stats - 统计信息
   */
  updateAgentStats(agentId, stats) {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    Object.assign(agent.stats, stats);
    agent.updatedAt = Date.now();
  }

  /**
   * 清理所有已销毁的Agent
   */
  cleanup() {
    const destroyedAgents = [];
    for (const [agentId, agent] of this.agents.entries()) {
      if (agent.state === 'destroyed') {
        destroyedAgents.push(agentId);
      }
    }

    for (const agentId of destroyedAgents) {
      this.agents.delete(agentId);
      this.agentStates.delete(agentId);
      this.agentConfigs.delete(agentId);
    }

    if (destroyedAgents.length > 0) {
      BotUtil.makeLog('info', `清理 ${destroyedAgents.length} 个已销毁的Agent`, 'AgentManager');
    }
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    const agents = Array.from(this.agents.values());
    const states = {};
    
    for (const agent of agents) {
      states[agent.state] = (states[agent.state] || 0) + 1;
    }

    return {
      total: agents.length,
      states,
      byWorkflow: agents.reduce((acc, agent) => {
        acc[agent.workflow] = (acc[agent.workflow] || 0) + 1;
        return acc;
      }, {})
    };
  }
}

export default new AgentManager();
