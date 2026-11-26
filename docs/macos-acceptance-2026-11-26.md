# macOS 实机验收：Folia 0.8.0 候选版

日期：2026-11-26。分支：`codex/repair-folia-080`。验收在测试 Mac 的候选扩展上进行，生产服务未部署。修复代码和本记录随该分支提交。

## 环境与方法

- Mac mini M4，16 GB，arm64；Spotify 1.3.10.2586，Spicetify 2.46.7。
- 使用原 `/Applications/Spotify.app`，通过 `spicetify enable-devtools restart` 启动。调试端口仅监听 `127.0.0.1:9222`，经现有 SSH 隧道采集。
- Chromium 156，ANGLE Metal Renderer: Apple M4；WebGL 和 GPU 合成启用。
- 窗口 1920×956 CSS 像素，DPR 2；部分渲染表面为 3840×1912，背景有自身分辨率限制。
- 每个模式预热 2.5 秒，Machi 7 秒，再采样 5 秒。帧数据是页面 requestAnimationFrame 回调间隔，不等同于显示器实际呈现帧率，也不是长期稳定性基准。
- 播放《庐州月》，测试时静音。换歌验证使用《月光》，测试结束恢复《庐州月》、暂停、102816 毫秒、音量 1。
- 首轮发现 Marketplace 旧加载器和本地候选版同时运行。测试先临时阻止旧加载器，随后备份 Marketplace 配置并停用旧条目，保留其他扩展。重新启动后确认只剩一套歌词按钮。

## 结果

17 种模式均成功挂载，没有触发 Still 错误降级。逐模式验证播放、暂停、拖动进度条、时钟同步与 850×650 布局；控制栏均保持在窗口内。

| 模式 | 5 秒回调数 | 帧间隔中位数 ms | P95 ms | 超过 50 ms 次数 |
| --- | ---: | ---: | ---: | ---: |
| Classic | 673 | 6.9 | 7.5 | 3 |
| Cadenza | 618 | 7.0 | 14.0 | 0 |
| Partita | 715 | 6.9 | 8.3 | 0 |
| Cappella | 670 | 6.9 | 8.6 | 3 |
| Tilt | 717 | 6.9 | 8.1 | 0 |
| Claddagh | 655 | 7.0 | 13.9 | 0 |
| Monet | 709 | 6.9 | 8.6 | 0 |
| Diorama | 501 | 8.0 | 15.0 | 0 |
| Pendolo | 720 | 6.9 | 8.3 | 0 |
| Sonnet | 543 | 7.0 | 14.0 | 0 |
| Tempera | 313 | 14.0 | 21.1 | 1 |
| Lumiere | 319 | 13.9 | 21.2 | 0 |
| Still | 720 | 6.9 | 8.2 | 0 |
| Nebbia | 720 | 6.9 | 8.1 | 0 |
| Hanabi | 430 | 13.8 | 14.9 | 0 |
| Machi | 199 | 27.7 | 28.1 | 0 |
| Metaphor | 394 | 13.9 | 14.9 | 0 |

该表来自首次模式遍历；后续修复针对暂停文字和播放栏挂载，未重新执行完整性能基准。Machi 是本次采样中最重的模式。不能据此宣称所有模式稳定达到 60 FPS。

原生全屏进入和退出成功。Escape 先关闭设置面板并保留歌词视图。下一首和上一首同步更新曲名与歌词，预缓存条件下分别约 702 和 738 毫秒。模式设置在关闭、重新打开时保留。

通过临时模拟 document 隐藏事件检查表面回收，画布数从 2 降到 0，恢复事件后回到 2。此项验证事件处理逻辑，未冒充真实最小化/锁屏测试。

## 发现并修复

### 暂停时 Classic / Partita 文字透明

歌词数据和时钟有效，但新挂载的 GlowWord / PartitaChunk 初始状态固定为 waiting，仅在后续时钟 change 事件更新。暂停后跳转、打开全屏或切换模式时，可能没有后续事件，文字一直透明。

修复为从当前时钟初始化，并在时间边界参数变化时同步状态。新增两项浏览器回归测试检查文字及祖先的实际透明度，修复前两项均失败；修复后与相关测试共 13 项通过。Folia 类型检查和离线构建通过。

Mac 上对修复后的 Classic、Partita 分别在暂停的 80.5 秒检查，可见词数均为 5。首次安装修复包后的文件哈希和运行脚本哈希一致：`b59a168a7cd58966b5a500e0169dc0937b3f64277214d4c086cf0409a32aedda`。

### Mac 播放栏图标被圆形遮罩裁切

Spotify 1.3.10 的队列按钮外增加了 Queue/Jam 分组。原兼容回退固定取队列按钮的祖父节点，把扩展按钮插入了分组。分组规则 `> :not(:first-child)` 给后续元素加圆形 mask，导致歌词图标和队列图标缺一块，并遗漏了同级的原生全屏按钮。

修复为向上查找同时包含音量、全屏或迷你播放器控制的共同容器。扩展按钮和队列恢复完整，原生全屏按钮按原设计隐藏。新增覆盖带遮罩分组及 React 整体替换的浏览器用例，4 项兼容测试全部通过；Deno 类型检查和离线构建通过。Mac 当前会话验证所有相关 mask 均为 none。

修复后的两个按钮已用真实鼠标事件验证：歌词页可进入并显示激活状态，全屏按钮可进入原生全屏，Escape 能退出。播放位置和暂停状态保持。

包含两项修复的最终候选包 SHA-256：`9be5916588b67b9f728b8c7b1b83b3910dd930c509f5d5bb218aeb41016df1c6`。

最终包已上传 Spicetify Extensions 目录并在当前会话加载；应用目录仍受 macOS 本机写入限制，需要执行 `spicetify apply` 后核对持久安装。推送前尝试复核时 SSH 连接被拒绝，因此最后一次持久安装尚未确认。

## 回收与限制

Classic / Machi 交替开关 10 次后，Folia 宿主均移除，Spotify 主界面 display 恢复，按钮保持一份，detached script states 为 0。采样期间 GC 后 JS 堆从约 165.8 MiB 到 190.4 MiB，监听器也增长，因此不能把总进程内存判定为完全回收。

进一步跟踪发现每次导航产生 55 个 Spotify `xpui-modules.js` 的 pagehide 监听器，调用路径来自 `createStandalonePlayerInstance`。独立执行三次 Spotify 首页→搜索→首页，pagehide 数也依次从 939 到 994、1049、1104，重复了相同增长。一次 Folia 开关的 visibilitychange 注册与移除分别为 7 和 7。未修改 Spotify 内部播放器生命周期；仍需更长时间采样来排除其他保留对象。

Classic 暂停时 3 秒主线程 task 占比约 79%，播放时约 82%，关闭后约 15%；这是 CDP 的 task 时间指标，不是整机 CPU 百分比。暂停后的视觉动画仍有明显负载，后续如需降低功耗应单独评估。

运行日志还包括 Marketplace 的存储配额错误、Spotify/音频分析请求失败，以及 spotify:image 封面经 CORS 读取失败。设置保存已实测可用，歌词与播放控制正常；封面失败使用回退。离线候选包的本地渲染验收不覆盖尚未部署的 Worker 更改、在线首次下载、生产发布链或长期功耗。

## 本地证据

原始数据和截图保存在 `Server/.wrangler/macos-acceptance-20261126/`，该目录被 Git 忽略：

- `modes-results.json`、`interaction-results.json`：17 模式采样及交互结果。
- `lifecycle-results.json`、`final-checks.json`：开关回收、全屏、换歌及可见性检查。
- `installed-verification.json`：上一个安装包的运行哈希及播放状态恢复记录。
- `playbar-verification.json`、`playbar-crop-before.png`、`playbar-crop-after.png`：播放栏问题及修复效果。
- `review/`、`screenshots/`：逐模式截图。
- `marketplace-before-candidate.json`：停用重复旧条目前的安装清单备份。
