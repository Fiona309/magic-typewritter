// 播放真实 mp3 音效采样（怪奇物语素材）。按 M 静音。
// 采样在 start() 时异步加载解码；未解码完成前触发的音效会被静默跳过（文件很小，通常瞬间就绪）。
const SAMPLES = {
  click: 'assets/sfx-type.mp3',    // 输入字母：打字叮咚提示音
  bell: 'assets/sfx-space.mp3',    // 空格
  thud: 'assets/sfx-delete.mp3',   // 删除
  reveal: 'assets/sfx-reveal.mp3', // 整句展示
};

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.buffers = {};
  }

  start() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    // 异步拉取 + 解码所有采样
    for (const [name, url] of Object.entries(SAMPLES)) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => { this.buffers[name] = buf; })
        .catch((e) => console.warn('音效加载失败', url, e));
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  _play(name) {
    if (!this.ctx || this.muted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const buf = this.buffers[name];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    src.start();
  }

  click() { this._play('click'); }   // 输入字母
  bell() { this._play('bell'); }     // 空格
  thud() { this._play('thud'); }     // 删除
  reveal() { this._play('reveal'); } // 整句展示
  hit() { this._play('reveal'); }    // 兼容旧调用名
}
