# Better Lyrics 与 Unison

两个来源均已注册到默认 Worker 服务，使用现有请求预算、取消信号、诊断、来源屏蔽和统一歌词格式。逐字阶段仍为 15 秒，逐行阶段仍为 10 秒，纯文本结果在有时序的来源全部失败后才会采用。

## 请求头

Better Lyrics 的三个入口，以及 Unison 的查询、条件 GET 和版本核验搜索，均使用 Firefox 160 / Linux 的浏览器兼容 UA。UA 原样发送，插件身份写入 X-User-Agent: beautiful-lyrics-reborn，其他来源继续使用原有身份规则。

Accept、Accept-Language、DNT、Sec-GPC、Upgrade-Insecure-Requests、Sec-Fetch-* 和 Priority 使用浏览器请求值；Host、连接头和 Accept-Encoding 交给 fetch runtime 协商，避免主机路由、HTTP/2 连接头和自动解压冲突。

## Better Lyrics

| 来源标识 | 普通 GET 接口 | 格式与查询阶段 |
| --- | --- | --- |
| betterlyrics | https://api.betterlyrics.org/getLyrics | TTML；逐字阶段请求，逐行或静态结果保留到对应回退阶段 |
| betterlyrics-qq | https://api.betterlyrics.org/qq/getLyrics | QRC；逐字阶段请求，逐行结果保留到回退阶段 |
| betterlyrics-kugou | https://api.betterlyrics.org/kugou/getLyrics | LRC；逐行阶段请求 |

参数为 s（歌名）、a（首位有效歌手）、al（可选专辑）和 d（可选有效时长，四舍五入到整秒）。歌词转换仍保留原始精确时长。三个入口独立参与竞速，现有直连酷狗、QQ、网易等来源也参与查询。来源均展示链接到 Better Lyrics 的署名。

请求不携带 API Key、JWT、Spotify 凭证或其他鉴权。根据[官方认证说明](https://docs.betterlyrics.org/docs/authentication)，TTML 的已有缓存可匿名读取，未缓存歌曲在服务器启用 API_KEY_REQUIRED 时需要 Key；目前不向新用户发放 Key。酷狗和 QQ 入口不需要 Key，但仍受限流影响。401、403、404、429、503 等响应让对应来源返回无结果，不绕过验证，也不立即重试。

TTML 保留原始 XML 空白、逐字时间、背景人声和对唱。QRC 使用绝对毫秒时序并转换为秒，保留零时长空格和词内分段关系。LRC 的最后一行按有效歌曲时长收尾。

## Unison

入口为 https://unison.betterlyrics.org/lyrics。已知 ISRC 时优先使用 ISRC，同一请求也传递有效 Spotify ID、Apple Music ID 和可用的歌名、歌手、专辑、时长，供上游按其顺序回退。读取无需 Key 或用户签名，不请求个性化结果。

响应的 TTML、增强 LRC、普通 LRC、plain 分别转换为可用的逐字、逐行或静态歌词。优先根据实际时间标签判断同步类型，保留增强 LRC 的词内拼接。

响应必须包含有效的 YouTube videoId 和提交者 keyId/displayName。歌词末尾展示 Lyrics from Unison 及 submitted by，分别链接到 song/<videoId> 和 curator/<keyId>。缺少有效署名的结果不会采用或缓存。使用范围与署名要求见[官方说明](https://github.com/better-lyrics/unison#who-can-use-unison)及[数据许可](https://github.com/better-lyrics/unison/blob/320e632ab411897135df04ff368d59fa1611e16d/LICENSE-DATA.md)。

元数据匹配会校验歌名、歌手及可用的 ISRC、专辑、时长。主 /lyrics 响应不提供时长；matchedBy=linked_video 时，额外请求一次 /lyrics/search?q=<videoId>，核验同一提交的时长与 Spotify 相差不超过 2 秒。无法确认版本的结果被弃用。

所有类型的 Unison 结果在服务端和客户端均缓存 10 分钟。Provider 保留最多 32 条、2 MB、1 小时的 ETag 快照，每次回源仍须条件 GET，304 才能复用快照。429 按 Retry-After 暂停该实例的 Unison 查询；503 只暂停对应查询键，避免一首待匹配歌曲影响其他歌曲。没有负缓存或过期歌词兜底。

## 验证边界

发布时须同步构建并发布新版插件客户端，才能启用新来源的完整署名与 Unison 十分钟本地缓存。

解析、署名、匹配、错误隔离、取消、查询阶段与缓存更新由本地测试覆盖。

2026-11-13 在当前环境使用实际 provider 代码和浏览器兼容请求头验证：Better Lyrics 的 Blinding Lights TTML、QQ 均返回 200 并解析为逐字歌词；酷狗返回 404。Unison 的 Blinding Lights 查询返回 404，搜索返回 200；FR8EU2300090（Explorer）按 ISRC 查询返回 200，解析为逐字歌词并保留完整署名。此前的 Cloudflare 403 / 1010 没有在这组请求中出现。这些结果不代表生产 Worker 已部署或所有歌曲、服务器出口均可用，也不证明新入口比直连接口更稳定。
