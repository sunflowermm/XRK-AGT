/**
 * AIStream 配置工具
 * 统一 LLM/ASR/TTS 配置读取，供 device、xiaozhi、stream 等模块复用
 */
import cfg from '#infrastructure/config/config.js';

const ensureConfig = (value, configPath) => {
    if (value === undefined) {
        throw new Error(`配置缺失: ${configPath}`);
    }
    return value;
};

export const getAistreamConfig = () => ensureConfig(cfg.aistream, 'aistream');

/** 可选读取：无 aistream 时返回 {}，供 loader/mcp/debug 等使用 */
export const getAistreamConfigOptional = () => cfg.aistream ?? {};

/**
 * 获取 LLM 调用配置。底层工厂用 aistream.llm.Provider + cfg[Provider]_llm，不依赖 profiles。
 * 有 profiles/models 时做工作流/预设合并；没有时直接用 llm 段（Provider、timeout、persona 等）。
 */
export const getLLMSettings = ({ workflow, persona, profile } = {}) => {
    const section = ensureConfig(getAistreamConfig().llm, 'aistream.llm');
    if (section.enabled === false) return { enabled: false };

    const profiles = section.profiles || section.models;
    const hasProfiles = profiles && typeof profiles === 'object' && Object.keys(profiles).length > 0;

    if (!hasProfiles) {
        const provider = (section.Provider || section.provider || '').toLowerCase();
        return {
            enabled: true,
            workflow: workflow || section.defaultWorkflow || 'device',
            workflowKey: workflow || 'device',
            profile: null,
            profileKey: null,
            profileLabel: null,
            persona: persona ?? section.persona,
            displayDelay: section.displayDelay,
            ...section.defaults,
            ...section,
            provider: provider || undefined
        };
    }

    const defaults = section.defaults || {};
    const workflows = section.workflows || {};
    const workflowKey =
        workflow ||
        section.defaultWorkflow ||
        section.defaultModel ||
        Object.keys(workflows)[0] ||
        Object.keys(profiles)[0];
    const workflowPreset = workflowKey ? workflows[workflowKey] : null;
    const requestedProfile =
        profile ||
        workflowPreset?.profile ||
        section.defaultProfile ||
        section.defaultModel;
    const profileKey = profiles[requestedProfile] ? requestedProfile : Object.keys(profiles)[0];
    const selectedProfile = profiles[profileKey];
    if (!selectedProfile) return { enabled: false };
    const overrides = workflowPreset?.overrides || {};
    const personaResolved = persona ?? workflowPreset?.persona ?? section.persona;

    return {
        enabled: true,
        workflow: workflowKey,
        workflowKey,
        workflowLabel: workflowPreset?.label || workflowKey,
        profile: profileKey,
        profileKey,
        profileLabel: selectedProfile.label || profileKey,
        persona: personaResolved,
        displayDelay: section.displayDelay,
        ...defaults,
        ...selectedProfile,
        ...overrides
    };
};

/** volcengine 基础配置，供 xiaozhi 等模块复用 */
export const getVolcengineAsrConfig = () => cfg.volcengine_asr || {};
export const getVolcengineTtsConfig = () => cfg.volcengine_tts || {};

export const getTtsConfig = () => {
    const aistream = getAistreamConfig();
    const section = aistream.tts || {};
    if (section.enabled === false) return { enabled: false };

    const provider = (section.Provider || section.provider || 'volcengine').toLowerCase();
    if (provider !== 'volcengine') throw new Error(`不支持的TTS提供商: ${provider}`);

    const baseConfig = ensureConfig(cfg.volcengine_tts, 'volcengine_tts');
    return { enabled: true, provider, ...baseConfig };
};

export const getAsrConfig = () => {
    const aistream = getAistreamConfig();
    const section = aistream.asr || {};
    if (section.enabled === false) return { enabled: false };

    const provider = (section.Provider || section.provider || 'volcengine').toLowerCase();
    if (provider !== 'volcengine') throw new Error(`不支持的ASR提供商: ${provider}`);

    const baseConfig = ensureConfig(cfg.volcengine_asr, 'volcengine_asr');
    return { enabled: true, provider, ...baseConfig };
};

export const getSystemConfig = () => ensureConfig(cfg.device, 'device');
