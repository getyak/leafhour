# 阅读氛围素材

这些资源随阅读器本地提供，运行时不连接第三方媒体服务。软件的 AGPL-3.0 不替代以下资源的许可。下载与加工后的文件哈希见 manifest.json。

## 摄影

依据各作品页面明确标注的 Unsplash License，下载并压缩为本地 JPEG。许可：https://unsplash.com/license 。图片用于阅读器场景，不单独销售，也不构建图库。

- forest.jpg：Sergey Antonov，https://unsplash.com/photos/sunlight-streams-through-a-dense-mossy-forest-bffRhBAmwCQ
- rain.jpg：Suhyeon Choi，https://unsplash.com/photos/rain-drops-on-window-glass-HCDugQDdtfc
- hearth.jpg：Henrique Sá，https://unsplash.com/photos/burning-fireplace-cxcCJVep9DI
- sea.jpg：Chris Grafton，https://unsplash.com/photos/calm-sea-under-clear-sky-i_cZJmcpqMA

## 环境录音

以下五份录音来自原作者 Joseph SARDIN 在 BigSoundBank 发布的作品页面；逐页明确标注 CC0（public domain）。许可文本：[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。署名保留以便追溯，并不将它们声明为本项目原创。

| 本地文件 | 原作品与逐文件许可页面 | 作者 |
| --- | --- | --- |
| wind.mp3 | [Wind in a Tree · 0659](https://bigsoundbank.com/wind-in-a-tree-s0659.html) | Joseph SARDIN |
| birds.mp3 | [Birds waking #2 · 0935](https://bigsoundbank.com/wake-birds-2-s0935.html) | Joseph SARDIN |
| rain.mp3 | [Rain on Puddle · 1290](https://bigsoundbank.com/rain-on-puddle-s1290.html) | Joseph SARDIN |
| fire.mp3 | [Big branching fire #2 · 0988](https://bigsoundbank.com/big-branching-fire-2-s0988.html) | Joseph SARDIN |
| waves.mp3 | [Cliff #1 · 2570](https://bigsoundbank.com/cliff-1-s2570.html) | Joseph SARDIN |

2026-10-18（上海时间）核对作品页面后下载原始 MP3。逐文件下载地址、作者、许可声明、核对时间、页面 SHA256、原始音频 SHA256 与交付音频 SHA256/字节数均保存在 `manifest.json`。清单保留来源证据，不能独立证明权利归属。

加工：原文件从第 2 秒截取 32 秒，使用 `loudnorm=I=-24:TP=-3:LRA=7`，首尾 0.6 秒淡化，48kHz 双声道、96kbps MP3，去除元数据。参数逐文件记录在清单。独立 Chromium 实际解码五份交付文件均成功，时长约 32.04 秒，48kHz 双声道，有非零有限信号且峰值未削波；这不是主观听感或无缝循环质量的宣称。

这些文件替换了原先从 Moodist 获取的五份录音。旧上游只有 Pixabay Content License / CC0 的混合说明，没有逐文件映射，因此未将旧文件追认为 CC0，也没有重写历史。当前发布只使用上表明确来源的新文件。

## 音乐

四套主题的稀疏旋律由本项目的 atmosphere-audio.mjs 在本机合成，不使用第三方歌曲、网络电台或语音模型，不声称是实录钢琴或吉他演奏。编排与声音代码随本项目软件许可提供。
