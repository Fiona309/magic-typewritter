// MediaPipe Hands 手势输入（双手）：
//  指向 = 食指指尖位置（主手）
//  Pinch = 拇指食指捏合（确认字母）
//  ThumbsUp = 竖大拇指（空格）
//  Fist = 握拳（删除）
//  HandsUp = 双手举起（整句完成）
// 坐标已做水平镜像，与预览一致
// 全部本地自托管，不依赖 googleapis / jsdelivr（国内 CDN 常打不开）
// 目录名避开 vendor：EdgeOne Pages 部署会把 vendor/ 当依赖目录整个排除（404）
// 后缀用 .js 不用 .mjs：EdgeOne 给 .mjs 回 octet-stream，浏览器模块 MIME 校验会拒绝
import { FilesetResolver, HandLandmarker } from '../mediapipe/tasks-vision/vision_bundle.js';

const WASM_URL = 'mediapipe/tasks-vision/wasm';
const MODEL_URL = 'assets/hand_landmarker.task';

// 手部骨架连线（MediaPipe 21 关键点标准连接：拇指→小指 + 掌缘）
const HAND_CONNS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export class HandInput {
  constructor({ video, overlay, config }) {
    this.video = video;
    this.overlay = overlay;
    this.cfg = config;
    this.landmarker = null;
    this.tracking = false;
    this.debug = false;
    this.lastDetect = 0;
    this.lastVideoTime = -1;
    this.lastSeen = -Infinity;
    this._handsUpSeen = -Infinity;
    this._pinch = false;

    this.state = {
      present: false,
      x: 0.5, y: 0.5,      // 主手食指指尖（镜像+平滑）
      pinch: false,
      thumbsUp: false,
      fist: false,
      handsUp: false,
      cross: false,
    };
  }

  // WASM + 模型共 ~16MB，页面一打开就后台预载，别等用户点了按钮才开始下
  preload() {
    if (!this._preloadP) {
      this._preloadP = (async () => {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.3,
          minHandPresenceConfidence: 0.3,
          minTrackingConfidence: 0.3,
        });
      })();
    }
    return this._preloadP;
  }

  async init() {
    const cam = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        // 手机降分辨率：减少每帧纹理上传，识别更不卡
        video: { width: this.cfg.camW ?? 640, height: this.cfg.camH ?? 480, facingMode: 'user' },
        audio: false,
      });
      this.video.srcObject = stream;
      await new Promise((res) => { this.video.onloadedmetadata = res; });
      await this.video.play();
    })();
    await Promise.all([this.preload(), cam]);
    this.tracking = true;
  }

  setDebug(on) {
    this.debug = on;
    if (!on && this.overlay) {
      const g = this.overlay.getContext('2d');
      g.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
  }

  // 单手特征分析。归一化基准全部用「手内部相对长度」，
  // 对手的大小、离镜头远近、朝向都不敏感——这是识别稳定的关键。
  _analyze(lm) {
    const dist = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
    const base = Math.max(dist(0, 9), 1e-4);       // 手腕→中指根：最稳定的手内尺度
    const indexLen = Math.max(dist(5, 8), 1e-4);   // 食指长度

    // 捏合：拇指尖↔食指尖 / 食指长度。捏合时 ~0.2，张开时 ~1.0
    const pinch = dist(4, 8) / indexLen;
    // 食指伸展度：指向/捏合时 ~1.6+，收回时 ~1.0
    const indexExt = dist(8, 0) / base;

    // 整体蜷握度：四指指尖到手腕 vs 掌骨到手腕。张开 ~1.8，握拳 ~1.0
    const tips = [8, 12, 16, 20], mcps = [5, 9, 13, 17];
    let tipSum = 0, mcpSum = 0;
    for (let k = 0; k < 4; k++) { tipSum += dist(tips[k], 0); mcpSum += dist(mcps[k], 0); }
    const openness = tipSum / Math.max(mcpSum, 1e-4);

    // 拇指抬起程度：其余四指最高点 y 减去拇指尖 y（>0 表示拇指是最高的，即竖起）
    const otherTopY = Math.min(lm[8].y, lm[12].y, lm[16].y, lm[20].y);
    const thumbLift = (otherTopY - lm[4].y) / base;

    const c = this.cfg;
    const thumbExt = dist(4, 0) / base;   // 拇指伸展度（握拳时拇指收着，此值小）
    // 竖大拇指👍（空格）：整体蜷 + 拇指明显最高 + 拇指确实伸出
    const thumbsUp = openness < (c.thumbOpen ?? 1.5) && thumbLift > (c.thumbLift ?? 0.3)
      && thumbExt > (c.thumbExt ?? 1.05);
    // 剪刀手✌️（删除）：食指+中指伸出、无名指+小指蜷。放下时收指/张开，不经过任何其他手势姿势
    const midExt = dist(12, 0) / base;
    const ringExt = dist(16, 0) / base;
    const pinkyExt = dist(20, 0) / base;
    const ext = (c.scissorExtend ?? 1.5), curl = (c.scissorCurl ?? 1.35);
    const scissors = indexExt > ext && midExt > ext && ringExt < curl && pinkyExt < curl;
    // 握拳：仅保留供诊断，不绑定动作
    const fist = !thumbsUp && !scissors && indexExt < (c.indexCurl ?? 1.45) && openness < (c.fistOpen ?? 1.35);
    // 手是否举起（用于双手完成判定）：胸口以上即可，不必举过头顶
    const raised = lm[8].y < (c.raiseY ?? 0.62) && lm[0].y < 0.9;
    return { base, pinch, indexExt, midExt, openness, thumbLift, thumbExt, thumbsUp, scissors, fist, raised, indexY: lm[8].y };
  }

  update(now) {
    if (!this.tracking || this.video.readyState < 2) return;
    // 手机拉大检测间隔：单次推理耗时长，太密会把主线程卡成幻灯片
    if (now - this.lastDetect < (this.cfg.detectEveryMs ?? 30) || this.video.currentTime === this.lastVideoTime) {
      this._decay(now);
      return;
    }
    this.lastDetect = now;
    this.lastVideoTime = this.video.currentTime;

    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, now);
    } catch { return; }

    const hands = result.landmarks || [];
    if (hands.length === 0) {
      this._decay(now);
      if (this.debug) this._draw([]);
      return;
    }

    this.lastSeen = now;
    this.state.present = true;

    const feats = hands.map((lm) => ({ lm, f: this._analyze(lm) }));
    // 主手 = 食指指尖更高（正在指字母墙的那只）
    feats.sort((a, b) => a.f.indexY - b.f.indexY);
    const P = feats[0];

    // 拳形/👍 优先于捏合：握拳时拇指贴食指会满足捏合距离，必须先排除
    const fistLike = P.f.fist || P.f.thumbsUp;
    if (fistLike) {
      this._pinch = false;
    } else if (!this._pinch && P.f.pinch < this.cfg.pinchOn) {
      this._pinch = true;
    } else if (this._pinch && P.f.pinch > this.cfg.pinchOff) {
      this._pinch = false;
    }
    this.state.pinch = this._pinch;

    this.state.thumbsUp = feats.some((h) => h.f.thumbsUp);
    this.state.fist = P.f.fist;
    // 删除 = 主手剪刀手✌️（单手，内部仍用 cross 字段承载删除信号）
    this.state.cross = P.f.scissors;
    // 双手举起分开 = 完成整句。
    // MediaPipe 的第二只手经常整段丢失（不止一两帧），检测层给"延续窗口"：
    // 刚见过双手举起的 handsUpSustainMs 内，即使这帧只剩一只手也维持信号，
    // 否则主循环的保持计时永远凑不满 → 音效响了画面却不完成
    let handsUpNow = false, dx = -1;
    if (feats.length === 2) {
      dx = Math.abs(feats[0].lm[0].x - feats[1].lm[0].x);
      if (feats.every((h) => h.f.raised) && dx > (this.cfg.handsSeparate ?? 0.24)) handsUpNow = true;
    }
    if (handsUpNow) this._handsUpSeen = now;
    this.state.handsUp = now - this._handsUpSeen < (this.cfg.handsUpSustainMs ?? 400);
    // 原始数值（诊断面板用）
    this.vals = { pinch: P.f.pinch, open: P.f.openness, idx: P.f.indexExt, mid: P.f.midExt, dx };

    // 指向点：食指指尖，镜像 + EMA
    const rawX = 1 - P.lm[8].x;
    const rawY = P.lm[8].y;
    const a = this.cfg.smooth ?? 0.45;
    this.state.x += (rawX - this.state.x) * a;
    this.state.y += (rawY - this.state.y) * a;

    if (this.debug) this._draw(hands);
  }

  _decay(now) {
    if (this.state.present && now - this.lastSeen > this.cfg.lostGraceMs) {
      this.state.present = false;
      this.state.pinch = false;
      this.state.thumbsUp = false;
      this.state.fist = false;
      this.state.handsUp = false;
      this.state.cross = false;
      this._pinch = false;
    }
  }

  _draw(hands) {
    const cv = this.overlay;
    if (!cv) return;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    for (const lm of hands) {
      // 骨架连线（MediaPipe 21 关键点标准连接）
      g.strokeStyle = 'rgba(255, 217, 102, 0.5)';
      g.lineWidth = 1.5;
      for (const [a, b] of HAND_CONNS) {
        g.beginPath();
        g.moveTo((1 - lm[a].x) * cv.width, lm[a].y * cv.height);
        g.lineTo((1 - lm[b].x) * cv.width, lm[b].y * cv.height);
        g.stroke();
      }
      g.fillStyle = '#ffd966';
      for (const p of lm) {
        g.beginPath();
        g.arc((1 - p.x) * cv.width, p.y * cv.height, 3, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = this.state.pinch ? '#fff' : 'rgba(255,217,102,0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc((1 - lm[8].x) * cv.width, lm[8].y * cv.height, 9, 0, Math.PI * 2);
      g.stroke();
    }
  }
}
