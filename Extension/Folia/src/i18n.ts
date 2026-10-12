import { createInstance } from 'i18next';

// Each full-screen root owns its translator; Spotify and other extensions keep theirs.
const en = {
  ui: { backToHome: 'Back to Spotify', waitingForMusic: 'Instrumental', noTrack: 'No track' },
  settings: 'Visual settings', mode: 'Lyrics mode', background: 'Background', fontSize: 'Font size',
  lyrics: 'Show lyrics', subtitles: 'Show subtitles', offset: 'Lyrics offset', reset: 'Reset',
  loading: 'Loading lyrics…', missing: 'No lyrics available', instrumental: 'Instrumental',
  static: 'Unsynced lyrics', failed: 'This renderer could not start. Showing Still.',
  analysis: 'Audio analysis', available: 'Envelope / beat response', unavailable: 'Unavailable; lyrics remain active',
  audioLoading: 'Loading…', close: 'Close', enterFullscreen: 'Enter fullscreen', exitFullscreen: 'Back to cinema',
  play: 'Play', pause: 'Pause', prev: 'Previous track', next: 'Next track', shuffle: 'Shuffle', loop: 'Repeat',
  volume: 'Volume', seek: 'Playback position', like: 'Like', unlike: 'Unlike', playlist: 'Add to playlist',
  feedback: 'Report lyrics problem', library: 'Library', search: 'Search playlists', retry: 'Retry',
  empty: 'No playlists in this folder', add: 'Add', added: 'Added', newFolder: 'New folder',
  newPlaylist: 'New playlist', name: 'Name', create: 'Create', changed: 'Track changed. Select the playlist again.',
};
const zh: typeof en = {
  ui: { backToHome: '返回 Spotify', waitingForMusic: '纯音乐', noTrack: '暂无歌曲' },
  settings: '视觉设置', mode: '歌词模式', background: '背景', fontSize: '字号', lyrics: '显示歌词',
  subtitles: '显示字幕', offset: '歌词偏移', reset: '重置', loading: '正在加载歌词…', missing: '暂无歌词',
  instrumental: '纯音乐', static: '无时间轴歌词', failed: '此模式未能启动，已切换为 Still。',
  analysis: '音频分析', available: '响度 / 节拍律动', unavailable: '暂无分析数据，歌词正常显示',
  audioLoading: '正在加载…', close: '关闭', enterFullscreen: '进入全屏', exitFullscreen: '返回影院模式',
  play: '播放', pause: '暂停', prev: '上一首', next: '下一首', shuffle: '随机播放', loop: '循环播放',
  volume: '音量', seek: '播放进度', like: '收藏', unlike: '取消收藏', playlist: '添加到歌单',
  feedback: '反馈歌词问题', library: '资料库', search: '搜索歌单', retry: '重试', empty: '此文件夹没有歌单',
  add: '添加', added: '已添加', newFolder: '新建文件夹', newPlaylist: '新建歌单', name: '名称', create: '创建',
  changed: '歌曲已切换，请重新选择歌单。',
};
export function makeI18n(language: string) {
  const instance = createInstance();
  void instance.init({ lng: language.startsWith('zh') ? 'zh' : 'en', fallbackLng: 'en', initAsync: false,
    resources: { en: { translation: en }, zh: { translation: zh } }, interpolation: { escapeValue: false } });
  return instance;
}
