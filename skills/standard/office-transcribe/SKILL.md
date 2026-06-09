---
name: office-transcribe
description: 音频/视频转文字、字幕时间轴、说话人分段；Whisper/faster-whisper，转写后接纪要
---

## 何时使用

会议录音、语音备忘、采访、`.mp3` `.wav` `.m4a` 转文字、要 SRT 字幕。

## 流程

1. 音频放入工作区（或用户提供路径）
2. `run` 执行转写脚本，输出 `.txt` / `.srt` / `.json`
3. 长音频：按 `office-meeting` 出纪要；短备忘：摘要 5 条

## 推荐：faster-whisper（本地）

```python
from faster_whisper import WhisperModel
model = WhisperModel("large-v3", device="cpu", compute_type="int8")
segments, info = model.transcribe("meeting.mp3", language="zh", vad_filter=True)
lines = []
for seg in segments:
    lines.append(f"[{seg.start:.1f}s-{seg.end:.1f}s] {seg.text.strip()}")
open("transcript.txt", "w", encoding="utf-8").write("\n".join(lines))
```

```bash
pip install faster-whisper
# 可选 GPU：device=cuda
```

## 说话人分段

Whisper 原生无 diarization；需 `pyannote` 等额外模型时先说明环境与授权。

## SRT 字幕

```python
def fmt(t):
    h, r = divmod(int(t), 3600); m, s = divmod(r, 60); ms = int((t % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
# 每 segment 写一条 SRT 块
```

## 禁止

- 不声称已转写除非输出文件存在
- 敏感录音提醒用户脱敏后再写入 `memory/`

## 缺环境

无 faster-whisper / 无 run → 请用户提供文字稿或外部转写结果；见 **office-env-setup**
