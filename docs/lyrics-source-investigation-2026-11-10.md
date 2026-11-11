# 歌词源排查与调研 · 2026-11-10

这次检查了线上近 7 天统计、近 24 小时的请求诊断、当前源码和公开接口。网易云接口及现有 YRC 解析在本机可以工作，线上故障集中在搜索阶段；另有可利用的逐字歌词来源，包括 LRCLIB 的新字段与 lrc.red。

## 网易云为什么是 0%

2026-11-10 10:21 中国时间读取的线上 `/stats?days=7`：

- 全站 82,318 次请求，其中 39,617 次拿到歌词，约 48.1%。这是请求成功率，包含重复查询，不代表不同歌曲的覆盖率。
- 网易云逐字阶段成功 0 次，逐行阶段成功 0 次。
- 两个阶段共 125,608 次尝试，其中 111,235 次记为 `none`、1,546 次 `failed`、215 次 `timeout`、12,612 次 `cancelled`。两个阶段可能查询同一首歌，不能当成歌曲数。

当前 [网易云实现](../Server/src/providers/netease.ts) 的流程是搜索 `music.163.com/api/search/get/web`，验证歌名、歌手及时间差，然后调用 `/api/song/lyric/v1`，分别解析 `yrc.lyric` 和 `lrc.lyric`。

近 24 小时 D1 诊断的搜索结果如下。详细业务分类在此前日志改动上线后才开始记录，不能把这些分类直接外推为全部 7 天的分布。

| 搜索响应 | 逐字阶段 | 逐行阶段 | 含义 |
| --- | ---: | ---: | --- |
| HTTP 200、业务 code 200，缺少歌曲列表 | 2,625 | 1,623 | 没有候选歌曲，流程无法进入歌词下载 |
| HTTP 200、业务 code 405 | 152 | 107 | 业务错误 |
| HTTP 200、业务 code -462 | 122 | 92 | 业务错误 |
| HTTP 200、业务 code 406 | 42 | 32 | 业务错误 |

这个窗口内没有观察到网易云的歌词下载请求。大量 `none` 是由于搜索响应缺失列表；不能理解为“网易云歌曲都有搜到，只是没有逐字歌词”。现有代码对没有明确错误码的缺失列表保留 `missing_song_list`，没有直接假定是哪种风控错误。

本机直接运行当前 `createNeteaseProvider`，使用与正式实现相同的请求头、搜索和转换流程：

| 曲目 | 网易云 ID | 结果 |
| --- | --- | --- |
| 成都 — 赵雷 | 436514312 | 搜索成功，解析为 44 行逐字歌词 |
| Take Me To Church — Hozier | 28160720 | 搜索成功，解析为 80 行逐字歌词 |

因此，接口彻底失效、返回格式全面变化、YRC 解析器损坏，都不符合目前证据。云端出口受到上游限制或风控是主要嫌疑；目前还不能区分具体地域规则、共享出口信誉或请求频率限制。尝试通过临时 Cloudflare 远程预览取得相同请求的原始响应时，预览访问超时，未取得有效对照数据；预览已停止。本次没有完成网易云的线上修复验收。

网易云适合优先验证插件本地获取方案，保留超时、取消、缓存、匹配校验和来源诊断。客户端跨域请求通道需要在真实 Spotify 中验收，不能把本机 Node.js 成功直接等同于插件内已经可用。当前维护中的 [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 仍实现 `/api/song/lyric/v1`；[LDDC 的网易云适配](https://github.com/chenmozhijin/LDDC/blob/main/LDDC/core/api/lyrics/ne.py) 采用客户端接口和游客会话，可作为协议维护参考。

## 值得接入或补齐的来源

| 来源 | 调研及实测 | 对当前项目的价值 |
| --- | --- | --- |
| [lrc.red](https://lrc.red/api) | 支持歌名/歌手搜索、ISRC 查询，以及 TTML、LRC、Lyricsfile；三次代表性查询都取到可解析的逐字 TTML | 优先考虑新增的来源；已有 TTML 转换器可以复用 |
| [LRCLIB](https://lrclib.net/docs.txt) | 现在返回 `hasWordSync` 和 `lyricsfile`，其中 `lines[].words` 包含逐字时间 | 已接入但能力没用全，优先补齐逐字解析和候选排序 |
| [AMLL TTML DB](https://github.com/amll-dev/amll-ttml-db) | 词库持续更新，支持 Spotify、网易云、QQ、Apple Music ID 索引；两份已收录文件可直接解析 | 人工校对逐字歌词的补充来源；覆盖范围不能按文件可用性推断 |
| [YouLy+ / LyricsPlus](https://github.com/ibratabian17/LyricsPlus) | 有逐字、逐行、TTML 接口，聚合多平台并接受投稿；仓库声明的公开服务两次实测均为 HTTP 530 | 保留候选，当前不优先依赖其公共实例 |

lrc.red 的三个样本是《Take Me To Church》《成都》《Anti-Hero》，分别解析为 79、44、48 行逐字歌词。搜索会返回 EP、现场、原声等多个版本，接入时应优先使用可信 ISRC；只有歌名和歌手时还要校验版本和时长，不能固定拿第一条。以上是有限样本验证，不是生产成功率估计。

lrc.red 要求请求标识应用及联系信息，并在展示数据的位置明确标注、链接来源；浏览器可用 `X-Client-ID` 替代受限制的 User-Agent。接入时需按[官方 API 说明](https://lrc.red/api)处理来源展示和限流。

LRCLIB 对《Take Me To Church》《Anti-Hero》《成都》的三个查询都返回了至少一条逐字记录。当前 [LRCLIB 适配](../Server/src/providers/lrclib.ts) 只读取 `syncedLyrics` 和 `plainLyrics`，忽略了 `lyricsfile`；它还把专辑名作为搜索限制，并直接返回第一个可用结果。后续可以先按录音信息选择匹配版本，优先读取真实逐字时间，再回退到逐行。官方文档同时新增了客户端标识、注册及限流说明，需正确处理 `429`、`503` 和 `Retry-After`。

AMLLDB 在本仓库的提交 `53153df` 中被主动关闭，提交内容未说明原因。此次只评估词库可用性，未恢复该开关。抽取到的《NEO》《畢生よ》两份文件分别解析为 59、51 行逐字歌词；另外两个指定 ID 未命中，说明它适合作为补充，不能假设覆盖全部热门歌曲。

[Better Lyrics API](https://github.com/better-lyrics/api) 也值得了解，但其主源已经是 lrc.red，不能算另一个完全独立的词库。公开缓存与新歌抓取权限不同，默认新歌请求需要该服务的 API key。直接评估 lrc.red 更符合当前接入条件。[syncedlyrics](https://github.com/moehmeni/syncedlyrics) 当前 README 将 Deezer 标为失效、Lyricsify 标为受 Cloudflare 保护影响，不优先安排这两条路径。

## 建议的实施顺序

1. 验证网易云在真实插件内的本地获取，解决已证实的搜索链路问题。
2. 补齐 LRCLIB 的逐字字段，复用现有请求结果，避免为同一查询重复取词。
3. 新增 lrc.red，处理 ISRC/版本匹配、来源署名和逐行回退。
4. 明确此前关闭 AMLLDB 的原因后，再决定恢复为补充源。

还发现一个独立的优先排查项：SpicyLyrics 近 7 天成功数也是 0，失败 69,268 次；近 24 小时 D1 中有 HTTP 状态的 5,458 次请求全部为 403。应检查授权配置与上游访问限制，现有证据不足以确定是 API key 过期还是其他拒绝规则。

本次完成诊断与调研，未部署业务代码变更。之前恢复的 Paxsenix Apple Music 路径保持原有范围；上述建议不需要恢复 Paxsenix 的其他来源。
