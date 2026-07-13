// 主程序：Hover → Pinch 输入 → 👍空格 → ✊删除 → 🙌整句完成（灯全亮 + 句子居中）
import { CONFIG } from './config.js';
import { HandInput } from './HandInput.js';
import { AudioFX } from './AudioFX.js';

const $ = (id) => document.getElementById(id);
const els = {
  bgLit: $('bgLit'), stage: $('stage'), cursorDot: $('cursorDot'), hoverChip: $('hoverChip'),
  inputBox: $('inputBox'), inputText: $('inputText'),
  preview: $('preview'), cam: $('cam'), landmarks: $('landmarks'),
  hint: $('hint'), intro: $('intro'), startBtn: $('startBtn'),
  toast: $('toast'), hud: $('hud'),
  gestPanel: $('gestPanel'),
  gPinch: $('gPinch'), gSpace: $('gSpace'), gFist: $('gFist'), gHands: $('gHands'),
  vPinch: $('vPinch'), vSpace: $('vSpace'), vFist: $('vFist'), vHands: $('vHands'),
  tipHeart: $('tipHeart'), tipCard: $('tipCard'), tipClose: $('tipClose'),
  loadNote: $('loadNote'),
  deviceGate: $('deviceGate'), dgUrlText: $('dgUrlText'), dgCopy: $('dgCopy'), dgAnyway: $('dgAnyway'),
};

const params = new URLSearchParams(location.search);
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
// 桌面默认开调试（?nodebug 关）；手机屏幕小默认关（?debug=1 强开，供真机调阈值）
let DEBUG = params.has('debug') || (!params.has('nodebug') && !IS_TOUCH);
const FORCE_MOUSE = params.has('mouse');
const AUTO = params.has('auto');

let audio, hands;
let state = 'INTRO';         // INTRO | TYPING | CELEBRATE
let sentence = '';
let hovered = null;
let lastT = 0;

// 手势节奏控制
let prevPinch = false, prevThumb = false;
let thumbCooldownT = 0, handsUpT = 0, handsUpGraceT = 0;
let scissorT = 0, scissorFired = false; // 剪刀手保持计时（防张开↔握拳过渡误触）
let celebrateT = 0;
let completeSounded = false; // 展示音效是否已在"举起瞬间"播放，避免 doComplete 再播一次

// cover-fit 映射（背景用 object-fit:cover，字母坐标用同样的数学定位）
let dispW = 0, dispH = 0, offX = 0, offY = 0;
const bulbEls = {};   // 灯泡（彩色，主视觉）
const glowEls = {};   // 字母柔光（辅助）
let stableHover = null; // 捏合前最后悬停的字母（捏合瞬间食指会滑动，用它来提交）
let tipOpened = localStorage.getItem('tipOpened') === '1'; // 点开过一次就永久不再闪烁提醒

const mouse = { x: 0.5, y: 0.5, down: false, lastMove: 0 };

boot();

function boot() {
  // 生成 26 个字母的灯泡 + 柔光节点
  for (const letter of Object.keys(CONFIG.letters)) {
    const bulb = document.createElement('div');
    bulb.className = 'bulb';
    bulb.dataset.letter = letter;
    els.stage.appendChild(bulb);
    bulbEls[letter] = bulb;
    const glow = document.createElement('div');
    glow.className = 'letterGlow';
    els.stage.appendChild(glow);
    glowEls[letter] = glow;
  }
  sampleBulbColors();
  els.bgLit.decode?.().catch(() => {}); // 亮图提前解码，别等完成瞬间才解码大图
  layout();
  addEventListener('resize', layout);

  audio = new AudioFX();
  hands = new HandInput({
    video: els.cam, overlay: els.landmarks,
    config: {
      ...CONFIG.hand,
      smooth: CONFIG.hover.smooth,
      handsUpY: CONFIG.gestures.handsUpY,
    },
  });
  if (!FORCE_MOUSE) hands.preload().catch(() => {}); // 后台预载 WASM+模型，点开始时基本秒开

  addEventListener('pointermove', (e) => {
    mouse.x = e.clientX / innerWidth;
    mouse.y = e.clientY / innerHeight;
    mouse.lastMove = performance.now();
  });
  addEventListener('pointerdown', () => { mouse.down = true; });
  addEventListener('pointerup', () => { mouse.down = false; });
  addEventListener('keydown', (e) => {
    if (state !== 'TYPING' && e.key !== 'd' && e.key !== 'm') return;
    if (e.key === ' ') { e.preventDefault(); doSpace(); }
    else if (e.key === 'Backspace') doDelete();
    else if (e.key === 'Enter') doComplete();
    else if (e.key.toLowerCase() === 'm') { audio.setMuted(!audio.muted); toast(audio.muted ? '已静音' : '声音开启'); }
    else if (e.key.toLowerCase() === 'd') {
      DEBUG = !DEBUG;
      hands.setDebug(DEBUG);
      els.hud.style.display = DEBUG ? 'block' : 'none';
      els.stage.classList.toggle('debug', DEBUG);
      els.gestPanel.classList.toggle('on', DEBUG);
    }
  });

  if (DEBUG) { els.hud.style.display = 'block'; els.stage.classList.add('debug'); els.gestPanel.classList.add('on'); }

  els.startBtn.disabled = false;
  els.startBtn.textContent = '点亮灯泡';
  els.startBtn.onclick = start;

  // 打赏入口：点心展开小卡片 + 点赞特效；点开过就永久记住、之后不再闪烁提醒
  els.tipHeart.onclick = () => {
    const opening = !els.tipCard.classList.contains('on');
    els.tipCard.classList.toggle('on');
    els.tipHeart.classList.remove('hint');
    tipOpened = true;
    localStorage.setItem('tipOpened', '1');
    if (opening) spawnLikeBurst();
  };
  els.tipClose.onclick = () => els.tipCard.classList.remove('on');

  checkDevice();

  setState('INTRO');
  requestAnimationFrame(loop);
  if (AUTO) start();
}

// 设备网关：只拦 App 内置浏览器（微信/抖音/小红书等，调不了摄像头）→ 引导去真浏览器。
// 手机浏览器可以玩：竖屏由 rotateGate 引导横屏，布局有小屏适配。
// ?force=1 或点“还是想试试”可绕过。
function checkDevice() {
  const ua = navigator.userAgent;
  const inApp = /MicroMessenger|WeiBo|QQ\/|QQBrowser|TikTok|musical_ly|BytedanceWebview|Lark|XiaoHongShu|xhsdiscover|com\.xingin/i.test(ua);
  if (params.has('force') || FORCE_MOUSE || AUTO) return;   // 明确要绕过时不拦
  if (!inApp) return;

  els.dgUrlText.textContent = location.href;
  els.deviceGate.classList.add('on');
  els.dgCopy.onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); els.dgCopy.textContent = '已复制'; }
    catch { const r = document.createRange(); r.selectNode(els.dgUrlText); getSelection().removeAllRanges(); getSelection().addRange(r); els.dgCopy.textContent = '长按上方复制'; }
    setTimeout(() => (els.dgCopy.textContent = '复制'), 2000);
  };
  els.dgAnyway.onclick = () => els.deviceGate.classList.remove('on');
}

// 一轮打字结束、回到下一轮时，让那颗心轻轻闪一次（用户此刻注意力已从完成文字上移开）。
// 用户一旦点开过打赏卡片，就永久不再闪烁，绝不打扰。
function maybeHintTip() {
  if (tipOpened) return;
  els.tipHeart.classList.remove('hint');
  void els.tipHeart.offsetWidth; // 强制重排，确保动画能重新播放
  els.tipHeart.classList.add('hint');
  setTimeout(() => els.tipHeart.classList.remove('hint'), 4200);
}

// 点赞特效：点击时从心口喷出一簇上飘的小心心/星星 + 心脏 pop 一下，给足交互反馈
function spawnLikeBurst() {
  els.tipHeart.classList.remove('pop');
  void els.tipHeart.offsetWidth;
  els.tipHeart.classList.add('pop');
  const r = els.tipHeart.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const glyphs = ['❤', '💛', '❤', '✨', '💖'];
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('div');
    p.className = 'likeParticle';
    p.textContent = glyphs[i % glyphs.length];
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    p.style.fontSize = `${11 + Math.random() * 9}px`;
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.7; // 主要朝上散开
    const dist = 34 + Math.random() * 40;
    p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
    p.style.animation = `likeFloat ${0.7 + Math.random() * 0.5}s ease-out forwards`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }
  try { audio.bell(); } catch {}
}

function layout() {
  const W = innerWidth, H = innerHeight, A = CONFIG.bg.aspect;
  dispW = Math.max(W, H * A);
  dispH = Math.max(H, W / A);
  offX = (W - dispW) / 2;
  offY = (H - dispH) / 2;
  for (const [letter, def] of Object.entries(CONFIG.letters)) {
    glowEls[letter].style.left = `${offX + def.l[0] * dispW}px`;
    glowEls[letter].style.top = `${offY + def.l[1] * dispH}px`;
    bulbEls[letter].style.left = `${offX + def.b[0] * dispW}px`;
    bulbEls[letter].style.top = `${offY + def.b[1] * dispH}px`;
  }
}

function letterScreen(letter) {
  const [fx, fy] = CONFIG.letters[letter].l;
  return [offX + fx * dispW, offY + fy * dispH];
}

// 灯泡颜色采样：在暗图灯泡坐标附近找饱和度最高的像素（灯泡本色），提亮后做发光色
function sampleBulbColors() {
  const img = new Image();
  img.src = CONFIG.bg.dark;
  img.decode().then(() => {
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const win = Math.round(CONFIG.bulbSample * cv.width);
    // 采样不到鲜艳颜色时的回退色盘（怪奇物语经典灯色，按字母序循环）
    const palette = [[255, 74, 61], [61, 165, 255], [255, 210, 63], [69, 224, 111], [255, 122, 194]];
    let idx = 0;
    for (const [letter, def] of Object.entries(CONFIG.letters)) {
      const cx = Math.round(def.b[0] * cv.width);
      const cy = Math.round(def.b[1] * cv.height);
      const x0 = Math.max(0, cx - win), y0 = Math.max(0, cy - win);
      const w = Math.min(cv.width - x0, win * 2), h = Math.min(cv.height - y0, win * 2);
      const data = g.getImageData(x0, y0, w, h).data;
      let best = null, bestScore = -1;
      for (let i = 0; i < data.length; i += 8) {
        const r = data[i], gg = data[i + 1], b = data[i + 2];
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        // 纯饱和度优先：偏向"深但艳"的灯泡像素，避开"亮但灰"的墙纸
        const score = (mx - mn) * (0.4 + 0.6 * (mx / 255));
        if (score > bestScore) { bestScore = score; best = [r, gg, b]; }
      }
      if (!best || bestScore < 34) best = palette[idx % palette.length];
      idx++;
      // 提亮：最大通道拉到 255，再向白色靠 12%（点亮的灯泡）
      const mx = Math.max(...best, 1);
      const boost = best.map((c) => Math.min(255, Math.round((c * 255 / mx) * 0.88 + 255 * 0.12)));
      bulbEls[letter].style.setProperty('--c', `rgb(${boost[0]},${boost[1]},${boost[2]})`);
    }
  }).catch(() => {});
}

async function start() {
  els.startBtn.disabled = true;
  els.startBtn.textContent = '唤醒中…';
  audio.start();
  if (!FORCE_MOUSE) {
    els.loadNote.classList.add('on');
    try {
      await hands.init();
      els.preview.classList.add('on');
      if (DEBUG) hands.setDebug(true);
    } catch (err) {
      console.warn('摄像头不可用，退回鼠标模式', err);
      toast('摄像头不可用 — 鼠标模式：移动=指向，点击=输入，空格/退格/回车');
    } finally {
      els.loadNote.classList.remove('on');
    }
  } else {
    toast('鼠标模式：移动=指向 点击=输入 · 空格键=空格 退格=删除 回车=完成');
  }
  els.intro.classList.add('hidden');
  setState('TYPING');
  setHint('☝️ 指向字母 · 🤏 捏合输入 · 👍 空格 · ✌️ 剪刀手停一下=删除 · 🙌 双手举到胸前说完');
}

function setState(s) {
  state = s;
  window.__state = s;
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('on');
  setTimeout(() => els.toast.classList.remove('on'), 4200);
}

function setHint(text) {
  if (els.hint.textContent !== text) els.hint.textContent = text;
}

function renderSentence() {
  els.inputText.textContent = sentence;
  window.__sentence = sentence;
}

// ============ 输入动作 ============
function doLetter(letter) {
  if (!letter || sentence.length >= CONFIG.sentence.maxLen) return;
  sentence += letter;
  renderSentence();
  audio.click();
  const el = bulbEls[letter];
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 350);
}

function doSpace() {
  if (sentence.length === 0 || sentence.endsWith(' ')) return;
  if (sentence.length >= CONFIG.sentence.maxLen) return;
  sentence += ' ';
  renderSentence();
  audio.bell();
}

function doDelete() {
  if (sentence.length === 0) return;
  sentence = sentence.slice(0, -1);
  renderSentence();
  audio.thud();
}

function doComplete() {
  if (sentence.trim().length === 0) return;
  sentence = sentence.trim();
  renderSentence();
  setState('CELEBRATE');
  celebrateT = 0;
  els.inputBox.classList.add('center');
  els.bgLit.style.transition = 'opacity 0.6s';
  els.bgLit.style.opacity = '1';
  for (const el of Object.values(bulbEls)) el.classList.add('on');
  els.cursorDot.classList.remove('on');
  els.hoverChip.classList.remove('on');
  setHint('');
  if (!completeSounded) audio.reveal(); // 键盘回车/鼠标路径没经过"举起瞬间"，在此补播
  completeSounded = false;
}

// ============ 自动演示（?auto=1）：循环输入 "HI MOM" ============
const AUTO_SEQ = ['H', 'I', ' ', 'M', 'O', 'M', '⏎'];
let autoT0 = -1;
function autoInput(t) {
  if (state !== 'TYPING') { autoT0 = -1; return { present: false, x: 0.5, y: 0.5, pinch: false, thumbsUp: false, fist: false, handsUp: false }; }
  if (autoT0 < 0) autoT0 = t;  // 从进入 TYPING 起算，保证完整输入序列
  t -= autoT0;
  const step = 0.9;
  const i = Math.floor(t / step) % (AUTO_SEQ.length + 1);
  const phase = (t % step) / step;
  if (i >= AUTO_SEQ.length) return { present: true, x: 0.5, y: 0.7, pinch: false, thumbsUp: false, fist: false, handsUp: false };
  const ch = AUTO_SEQ[i];
  if (ch === ' ') {
    return { present: true, x: 0.5, y: 0.6, pinch: false, thumbsUp: phase > 0.4 && phase < 0.7, fist: false, handsUp: false };
  }
  if (ch === '⏎') {
    return { present: true, x: 0.5, y: 0.25, pinch: false, thumbsUp: false, fist: false, handsUp: phase > 0.2 };
  }
  const [sx, sy] = letterScreen(ch);
  return {
    present: true, x: sx / innerWidth, y: sy / innerHeight,
    pinch: phase > 0.55 && phase < 0.8,
    thumbsUp: false, fist: false, handsUp: false,
  };
}

function getInput(now) {
  if (AUTO) return autoInput(now / 1000);
  if (hands.tracking && hands.state.present) return { ...hands.state };
  const present = mouse.down || now - mouse.lastMove < 3000;
  return {
    present, x: mouse.x, y: mouse.y,
    pinch: mouse.down, thumbsUp: false, fist: false, handsUp: false, cross: false,
  };
}

// ============ 主循环 ============
function loop(now) {
  requestAnimationFrame(loop);
  const t = now / 1000;
  const dt = Math.min(lastT ? t - lastT : 0.016, 0.05);
  lastT = t;

  hands.update(now);
  const input = getInput(now);

  if (state === 'TYPING') updateTyping(dt, input);
  else if (state === 'CELEBRATE') updateCelebrate(dt);

  if (DEBUG) {
    els.hud.textContent = `${state} | hover:${hovered ?? '-'} | "${sentence}" | ${(1 / dt).toFixed(0)}fps`;
    els.gPinch.classList.toggle('active', input.pinch);
    els.gSpace.classList.toggle('active', input.thumbsUp);
    els.gFist.classList.toggle('active', input.cross);
    els.gHands.classList.toggle('active', input.handsUp);
    const H = CONFIG.hand;
    if (hands.vals) {
      els.vPinch.textContent = `${hands.vals.pinch.toFixed(2)}  需<${H.pinchOn}`;
      els.vSpace.textContent = `抬${hands.vals.lift.toFixed(2)} 需>${H.thumbLift}`;
      els.vFist.textContent = `中指${hands.vals.mid.toFixed(2)} 需>${H.scissorExtend}`;
      els.vHands.textContent = hands.vals.dx >= 0 ? `距${hands.vals.dx.toFixed(2)} 需>${H.handsSeparate}` : '只见到一只手';
    } else {
      els.vPinch.textContent = els.vSpace.textContent = els.vFist.textContent = els.vHands.textContent = '— 无手';
    }
  }
}

function updateTyping(dt, input) {
  // 指尖光标
  const px = input.x * innerWidth, py = input.y * innerHeight;
  if (input.present) {
    els.cursorDot.classList.add('on');
    els.cursorDot.style.left = `${px}px`;
    els.cursorDot.style.top = `${py}px`;
    els.cursorDot.classList.toggle('pinch', input.pinch);
    els.cursorDot.classList.toggle('fist', input.cross);
  } else {
    els.cursorDot.classList.remove('on');
  }

  // Hover：最近字母 + 迟滞。捏合/握拳期间【冻结】不重算——
  // 捏合瞬间食指会朝拇指滑动，若不冻结就会跳到旁边字母（误触根因）。
  let next = hovered;
  if (!input.present) {
    next = null;
  } else if (!input.fist && !input.pinch) {
    const R = CONFIG.hover.radius * dispW;
    let bestD = R, cur = null, curD = Infinity;
    for (const letter of Object.keys(CONFIG.letters)) {
      const [lx, ly] = letterScreen(letter);
      const d = Math.hypot(px - lx, py - ly);
      if (letter === hovered) curD = d;
      if (d < bestD) { bestD = d; cur = letter; }
    }
    next = cur;
    if (hovered && next && next !== hovered && curD < R * 1.4 && bestD > curD * CONFIG.hover.sticky) {
      next = hovered; // 粘滞在当前字母
    }
  }
  if (next !== hovered) {
    if (hovered) {
      glowEls[hovered].classList.remove('hover');
      bulbEls[hovered].classList.remove('hover');
    }
    hovered = next;
    if (hovered) {
      glowEls[hovered].classList.add('hover');
      bulbEls[hovered].classList.add('hover');
      els.hoverChip.textContent = `► ${hovered}`;
      els.hoverChip.classList.add('on');
    } else {
      els.hoverChip.classList.remove('on');
    }
  }

  // 捏合瞬间食指会朝拇指滑动、指针会偏离目标，
  // 所以提交的是"捏合开始前最后悬停"的字母
  if (!input.pinch) stableHover = hovered;
  if (input.pinch && !prevPinch && stableHover) doLetter(stableHover);
  prevPinch = input.pinch;

  // 👍 上升沿 + 冷却 → 空格
  thumbCooldownT = Math.max(0, thumbCooldownT - dt);
  if (input.thumbsUp && !prevThumb && thumbCooldownT <= 0) {
    doSpace();
    thumbCooldownT = CONFIG.gestures.thumbCooldown;
  }
  prevThumb = input.thumbsUp;

  // ✌️ 剪刀手保持 0.3s → 删除一个。
  // 手从张开收成拳（或松拳张开）的过渡瞬间，无名/小指先蜷、食中指还伸着，
  // 形状恰好就是剪刀手——靠"保持时长"过滤掉这种几帧的过渡态。
  // 触发一次后须放下再比，才删下一个。
  if (input.cross) {
    scissorT += dt;
    if (!scissorFired && scissorT >= (CONFIG.hand.scissorHold ?? 0.3)) {
      doDelete();
      scissorFired = true;
    }
  } else {
    scissorT = 0;
    scissorFired = false;
  }

  // 🙌 双手举起保持 → 整句完成
  // MediaPipe 双手检测会偶发掉帧（某帧只认出一只手），若立刻清零计时，
  // 保持时长永远凑不满 → 音效响了画面却不变。掉帧走宽限期，计时保留不清零。
  if (input.handsUp) {
    handsUpGraceT = 0;
    // 识别到举起的第一刻就开始播展示音效，不等句子居中展示（用户要求）
    if (handsUpT === 0 && !completeSounded && sentence.trim().length > 0) {
      audio.reveal();
      completeSounded = true;
    }
    handsUpT += dt;
    if (handsUpT >= CONFIG.gestures.handsUpHold) {
      handsUpT = 0;
      doComplete();
    }
  } else if (handsUpT > 0 && handsUpGraceT < CONFIG.gestures.handsUpGrace) {
    handsUpGraceT += dt;
  } else {
    handsUpT = 0;
    handsUpGraceT = 0;
    completeSounded = false; // 真正放下 → 重置，下次举起重新播
  }
}

function updateCelebrate(dt) {
  celebrateT += dt;
  const S = CONFIG.sentence;
  const flickStart = 1.0, per = 0.44;
  const flickEnd = flickStart + S.flickers * per;

  if (celebrateT >= flickStart && celebrateT < flickEnd) {
    // 全屋灯光闪烁：ON-OFF-ON
    const phase = (celebrateT - flickStart) % per;
    els.bgLit.style.transition = 'opacity 0.06s';
    els.bgLit.style.opacity = phase < per / 2 ? '0.15' : '1';
  } else if (celebrateT >= flickEnd) {
    els.bgLit.style.transition = 'opacity 0.6s';
    els.bgLit.style.opacity = '1';
  }

  if (celebrateT >= flickEnd + S.holdSec) {
    // 收尾：回到输入状态
    els.inputBox.classList.remove('center');
    els.bgLit.style.opacity = '0';
    for (const el of Object.values(bulbEls)) el.classList.remove('on');
    sentence = '';
    renderSentence();
    setState('TYPING');
    setHint('☝️ 指向字母 · 🤏 捏合输入 · 👍 空格 · ✌️ 剪刀手停一下=删除 · 🙌 双手举到胸前说完');
    maybeHintTip(); // 上一轮已收尾、注意力回落，此刻才轻轻闪一次心
  }
}
