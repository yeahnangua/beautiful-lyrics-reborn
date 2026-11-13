# 服务端歌词缓存

歌词正文保存在 Cloudflare Workers Cache。默认入口每次执行鉴权、限流和来源屏蔽规则读取，再通过内部的 LyricsOrigin.fetch 访问缓存。只有未命中时才运行歌词查询服务。

歌词专用 D1、歌曲索引和缓存 URL 表均已退出运行链路。FEEDBACK_DB 继续负责规则、反馈、请求诊断及实际查询诊断。插件也按来源设置本地缓存有效期，Unison 的社区更正和署名使用短缓存更新。

## 请求与缓存边界

1. 插件继续 GET /lyrics/:spotifyId，携带现有 Spotify bearer 和歌词会话。
2. 默认入口先验证会话及原有 token/IP 限流，再读取该歌曲的来源屏蔽规则。
3. 未配置规则库、读取失败或超过 2 秒预算时返回 503 source_policy_unavailable 和 Retry-After: 5，不读取歌词缓存。
4. 通过 ctx.exports.LyricsOrigin.fetch 访问内部缓存；不进行公网重定向，不回调公共歌词 URL。
5. 缓存未命中时执行现有 15 秒逐字、10 秒逐行及纯文本回退逻辑。
6. 默认入口校验结果身份、有效期、来源及内容哈希，生成本次 RequestId / RetrievedAt，再追加一次展示署名。

内部路径：

    /lyrics-body/v{lyricsCacheVersion}/{spotifyId}/{metadataHash}/{policyHash}

metadataHash 根据固定字段顺序包含歌名、歌手、专辑、时长、ISRC、Apple Music ID 及对应标题。保留歌手顺序，统一处理空值，忽略未知查询参数。policyHash 根据启用的 provider + lyricsType 组合排序去重后生成。两个指纹均使用 SHA-256。

版本 2 在 normalizeMetadata 中将有效时长四舍五入为整数秒，取整后不大于零则省略。缓存键和传给 LyricsOrigin 的查询上下文使用同一个归一化值，歌词匹配及末行结束时间据此生成。默认入口仍使用本次请求的原始时长追加署名，保留最后 100 毫秒的精确高亮时间。

不同有效用户使用相同查询上下文时共享缓存；Apple Music ID、归一化后的时长等上下文不同则区分。凭证、请求 ID、客户端版本和请求时间不进入键。ctx.props 保持为空。

内部请求从白名单重新构造，不继承外部 Cookie、会话头、Cache-Control、条件请求或转发覆盖头。Spotify token 只通过内部临时头供回源使用；中文上下文使用 UTF-8 / Base64 编码。内部请求及凭证不进入缓存或日志。

## 缓存对象与 TTL

缓存封装保存结构版本、曲目及上下文指纹、标准化歌词、来源及必要署名、内容哈希、originRunId、生成和到期时间。当前请求 ID、获取时间、查询诊断和生成的展示署名行不保存到缓存。

| 类型 | TTL | 内部 Cache-Control |
| --- | --- | --- |
| Syllable | 30 天 | public, max-age=2592000, must-revalidate |
| Line | 14 天 | public, max-age=1209600, must-revalidate |
| Static | 3 天 | public, max-age=259200, must-revalidate |
| Unison（所有类型） | 10 分钟 | public, max-age=600, must-revalidate |

Unison 的服务端和插件本地缓存均为 10 分钟。回源时使用限量 ETag 快照发送 If-None-Match；只有上游返回 304 才能复用快照，修改歌词或提交者署名后返回的新正文会替换快照。快照最多保存 32 条、2 MB、1 小时，不作为上游不可用时的过期兜底。

版本 4 加入 Better Lyrics 和 Unison，插件原始与转换后歌词缓存同步升级为版本 13，避免旧逐字结果遮住新来源。

空结果和错误明确 no-store；不启用负缓存、后台过期刷新或过期内容兜底。提前淘汰视为正常未命中。TTL 是允许使用的上限，不保证保存到期。

外部响应始终保留 private, no-store，以及 CDN-Cache-Control / Cloudflare-CDN-Cache-Control 的 no-store。X-Lyrics-Cache 显示内部 hit / miss / bypass / unknown；未访问缓存时省略。未知或失败的缓存调用仍计入尝试，不因缺少成功响应而从命中率分母消失。

## 跨部署共享与版本

默认入口缓存关闭，只有 LyricsOrigin 开启。cross_version_cache=true，普通部署继续复用已有歌词。

src/cache-version.ts 的 lyricsCacheVersion 是唯一的缓存内容版本，同时控制路径、封装校验和统计标记。以下改动需要评估并提升该版本：

- 返回格式或署名语义发生不兼容变化。
- 选源、歌曲匹配、歌词转换、缓存键归一化发生影响结果的变化。
- TTL 或来源许可规则要求立即撤销旧内容。

界面、文档及单纯日志改动不提升该版本。不要把扩展版本号或每次构建的版本 ID 放进缓存键。

当前代码使用版本 3，将歌词来源调整后的结果与旧选源策略隔离，并保留版本 2 的合作歌手匹配与时长归一化行为。部署版本 3 后逐步预热新缓存，统计使用 workers-cache-v3；历史基线和当次验收记录保留原值。插件原始与转换歌词缓存同步提升到版本 12，更新后不再读取旧版本歌词。此次版本升级不需要新增数据库迁移，也不修改歌词偏移量或其他用户设置。

来源屏蔽仍按每次请求读到的规则快照生效。变化后的规则使用新 policyHash，命中后还会检查实际 Source.Provider + Type。正在进行的请求只写入原规则对应的键。插件本地缓存的离线例外仍保留，下次成功读到规则时重新校验。

需要清理损坏内容时，由 LyricsOrigin.purgeTrack 在该入口自己的 ctx.cache 上按歌曲路径前缀清理；默认入口的缓存空间与它不同。缓存调用总预算为 27 秒：保留现有逐字 15 秒与逐行 10 秒，再为内部传输和响应处理留 2 秒余量。缓存异常最多允许一次 no-store 恢复，沿用同一个截止时间，不重新获得整轮预算。正常的无歌词或上游错误不额外重跑。

Cloudflare 自身合并同键并发请求，不增加分布式协调存储。因此不再提供原 D1 写入时的原子质量比较保证。

## 日志、诊断与统计

实际回源在 LyricsOrigin 输出一条带完整查询详情的业务日志；默认入口只为最终采用的缓存命中输出摘要，避免重复记录同一次查询。

    [lyrics-query] 成都 — 赵雷 | ✅ | 命中缓存 | 来源：lrc.red | 逐字 | 18ms
    [lyrics-query] 成都 — 赵雷 | ✅ | 来源：lrc.red | 逐字 | 1320ms
    [lyrics-query] 成都 — 赵雷 | ❌ | 来源：无 | 1320ms

耗时为示例。没有采用缓存时不显示缓存提示；查询失败、查询已取消保留文字。结构化 outcome 继续使用 success / none / failed / cancelled。

RequestId 标识用户请求；originRunId 标识实际回源。命中日志使用当前 RequestId，关联生成缓存的 originRunId，不复制历史 queries。

lyric_requests 保存逐次请求摘要；lyric_origin_runs 保存完整查询诊断，采用 gzip + Base64 的 JSON 封装，读取时无损还原，也兼容明文记录。反馈可以保留这份封装或已还原的诊断快照；请求、查询和反馈任意先后到达都会补齐关联。普通诊断保留 14 天，反馈继续保留自身证据。

统计按执行位置分开：

- server:request：每次用户请求，包含缓存状态和 workers-cache-vN 标记。
- server:origin：每次实际回源，记录查询次数和上游 HTTP 事件数。
- provider:*：只统计实际运行的来源尝试。缓存命中不虚增源成功率。

/stats 的 metrics.cache 按 cacheVersion 区分旧 D1 与新 CDN 数据，metrics.origins 提供实际回源计数。流量上涨时比较每次请求对应的回源次数，不只比较总量。

## 基线与流量验收

2026-11-10 15:05 北京时间，切换前 Analytics Engine 加权统计：

| 窗口 | 命中 | 未命中 | 命中率 |
| --- | ---: | ---: | ---: |
| 近 24 小时 | 1,631 | 7,765 | 17.36% |
| 近 7 天 | 12,874 | 68,843 | 15.75% |

相同 24 小时内保留的 6,230 条 D1 诊断只覆盖部分流量，不能当作完整总体。样本包含 3,700 首歌、4,092 个元数据变体；370 首歌存在多个变体，其中 334 首时长不同、80 首 Apple Music ID 有变化，原因可能重叠。

2026-11-11 对同一份样本模拟整数秒归一化：时长仍有差异的歌曲从 334 首降到 94 首，元数据变体从 4,092 个降到 3,858 个。这只衡量样本内的分键变化，不代表生产命中率已经提高，也不将时长差异较大的记录强行合并。

按时间从空缓存回放这批记录，并假设成功结果可重新取得、不淘汰缓存：仅歌曲与规则键得到 151 次命中，加入 metadataHash 后为 110 次，差 41 次、0.66 个百分点。对应冷启动回放命中率为 2.42% 与 1.77%。这不是 CDN 实际命中率预测：记录不完整，部分元数据可能已由上游补全，源可用性和 CDN 淘汰也无法据此确定。

验收分两阶段：

1. 上线功能验收：真实 Cloudflare 必须通过首次 MISS、重复 HIT、不同凭证共享、跨部署复用、来源屏蔽、独立请求 ID 和匿名拒绝。
2. 流量验收：前 7 天标为冷启动观察；此后滚动 7 天且有效请求不少于 6,000 时，命中率目标至少 12.75%，即旧 7 天基线允许下降 3 个百分点。同时实际回源/有效请求不超过旧基线的 1.10 倍，约 0.927。

新命中率分母包括 hit、miss、bypass、unknown；鉴权和规则读取失败另外观察。实际回源计数用于识别并发合并，不能简单把全部 miss 等同于独立回源。达到流量与时间条件之前，验收状态是待观察，不能宣称稳定期通过。

低于目标时检查元数据变体、BYPASS/UNKNOWN、跨版本设置和 CDN 淘汰，不自动去掉 metadataHash，也不因为命中率低而关闭缓存或清空内容。

## 部署与回退

Wrangler 固定为 4.159.0，Workers 类型使用配套版本，兼容日期 2026-11-10。运行时入口为 src/worker.ts，业务工厂可在 Node 测试中独立使用。

1. 执行服务端测试、类型检查、wrangler deploy --dry-run；配置变化后重新生成 worker-configuration.d.ts。
2. 通过原有鉴权部署检查，执行 FEEDBACK_DB 的新增迁移。
3. 发布新 Worker，验证真实请求与缓存，不读取或回填旧歌词正文。
4. 确认新版本不再依赖旧库后，删除准确匹配的 lyrics-cache 数据库；保留反馈库。

2026-11-10 已完成生产切换及旧库删除，功能测试、短时生产检查和待观察指标见 [当次验收记录](lyrics-cache-verification-2026-11-10.md)。

LYRICS_CACHE_MODE 默认 workers-cache，改为 off 时绕过缓存，但仍执行鉴权、限流和屏蔽规则。旧库删除后用这一模式回退，不回滚到依赖旧歌词库的历史版本。

Workers Cache 没有独立缓存存储费，命中及内部缓存入口调用仍计 Worker 请求。容量、请求额度和 CPU 用量分别观察。

参考：[Workers Cache](https://developers.cloudflare.com/workers/cache/)、[配置](https://developers.cloudflare.com/workers/cache/configuration/)、[缓存键](https://developers.cloudflare.com/workers/cache/cache-keys/)、[清理作用域](https://developers.cloudflare.com/workers/cache/purge/)。
