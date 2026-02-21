/**
 * 表情解析与映射工具
 * 统一 stream/device/xiaozhi 的表情处理逻辑
 */

/** 设备支持的表情代码列表 */
export const SUPPORTED_EMOTIONS = [
    'happy', 'sad', 'angry', 'surprise', 'love', 'cool', 'sleep', 'think', 'wink', 'laugh'
];

/** parseEmotion 与系统提示支持的中文表情标记（子集） */
export const PARSEABLE_EMOTIONS = ['开心', '惊讶', '伤心', '大笑', '害怕', '生气'];

/** 中文关键词 -> 表情代码 */
export const EMOTION_KEYWORDS = {
    '开心': 'happy',
    '伤心': 'sad',
    '生气': 'angry',
    '惊讶': 'surprise',
    '爱': 'love',
    '酷': 'cool',
    '睡觉': 'sleep',
    '思考': 'think',
    '眨眼': 'wink',
    '大笑': 'laugh',
    '害怕': 'sad'
};

/**
 * 从文本中解析 [开心]、[惊讶] 等情绪标记
 * @param {string} text - 原始文本
 * @returns {{ emotion: string|null, cleanText: string }}
 */
export function parseEmotion(text) {
    const group = PARSEABLE_EMOTIONS.join('|');
    const regex = new RegExp(`^\\s*\\[(${group})[\\]\\}]\\s*`);
    const match = regex.exec(text || '');
    if (!match) {
        return { emotion: null, cleanText: (text || '').trim() };
    }
    const emotion = EMOTION_KEYWORDS[match[1]] || null;
    const cleanText = (text || '').replace(regex, '').trim();
    return { emotion, cleanText };
}

/**
 * 从消息文本中查找第一个匹配的表情关键词，返回对应的表情代码
 * @param {string} text
 * @returns {string|null}
 */
export function findEmotionFromKeywords(text) {
    if (!text || typeof text !== 'string') return null;
    for (const [keyword, emotion] of Object.entries(EMOTION_KEYWORDS)) {
        if (text.includes(keyword)) return emotion;
    }
    return null;
}

/**
 * 统一将中文/英文表情规范为设备支持的代码，不支持的返回 null
 */
export function normalizeEmotionToDevice(emotion) {
    if (!emotion) return null;
    const code = EMOTION_KEYWORDS[emotion] || emotion;
    return SUPPORTED_EMOTIONS.includes(code) ? code : null;
}

/**
 * xiaozhi-esp32 / live2d 专用：中文或英文表情 → live2d emotionToActionMap 枚举
 * 与设备 happy/surprise/laugh 略有不同（laughing, surprised）
 */
export function emotionToXiaozhiEsp32(emotion) {
    const map = {
        开心: 'happy', 大笑: 'laughing', 惊讶: 'surprised', 伤心: 'sad',
        害怕: 'surprised', 生气: 'angry',
        happy: 'happy', laughing: 'laughing', laugh: 'laughing', surprised: 'surprised',
        surprise: 'surprised', sad: 'sad', angry: 'angry'
    };
    return (emotion && map[emotion]) || emotion || 'neutral';
}
