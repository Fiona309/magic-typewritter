import { CONFIG } from './config.js';
import { HandInput } from './HandInput.js';
import { AudioFX } from './AudioFX.js';

const $ = (id) => document.getElementById(id);
const els = {
  scene:$('scene'), base:$('base'), paper:$('paper'), keys:$('keys'),
  q1:$('question1'), a1:$('answer1'), q2:$('question2'), a2:$('answer2'), examples:$('examples'), reply:$('reply'),
  typebar:$('typebar'),
  posterName:$('posterName'), posterCreation:$('posterCreation'), posterReply:$('posterReply'), posterSerial:$('posterSerial'),
  cursor:$('cursorDot'), preview:$('preview'), cam:$('cam'), landmarks:$('landmarks'),
  intro:$('intro'), startBtn:$('startBtn'), loadNote:$('loadNote'), hint:$('hint'), toast:$('toast'), hud:$('hud'),
  restartNote:$('restartNote'), replayBtn:$('replayBtn'), deviceGate:$('deviceGate'), dgAnyway:$('dgAnyway'),
};

const params = new URLSearchParams(location.search);
const IS_TOUCH = matchMedia('(pointer:coarse)').matches;
const FORCE_MOUSE = params.has('mouse');
const DEBUG = params.has('debug');
const RESPONSES = {
  MUSIC:'LET THE WORLD HEAR IT.', GAMES:'BUILD A WORLD WORTH PLAYING.',
  STORIES:'MAKE SOMEONE FEEL SOMETHING.', FILMS:'TURN IDEAS INTO SCENES.',
  ART:'SHOW US WHAT YOU SEE.', MAGIC:'MAKE THE IMPOSSIBLE VISIBLE.',
  DESIGN:'GIVE IDEAS A SHAPE.', CODE:'MAKE THE IMPOSSIBLE WORK.',
  VIDEOS:'TURN A MOMENT INTO A WORLD.', DREAMS:'MAKE IT REAL.',
};

let audio, hands;
let mode = 'guided';
let state = 'INTRO';
let current = '', creatorName = '', creation = '', finalReply = '';
let hovered = null, stableHover = null;
let prevPinch = false, prevThumb = false;
let thumbCooldown = 0, scissorTime = 0, scissorFired = false, handsUpTime = 0, handsGrace = 0;
let lastFrame = 0, lastActivity = performance.now(), runToken = 0, posterTimer = 0;
let striking = false;
let dispW = 0, dispH = 0, offX = 0, offY = 0;
const keyEls = {};
const mouse = { x:.5, y:.5, down:false, lastMove:0 };

boot();

function boot() {
  for (const [letter, pos] of Object.entries(CONFIG.letters)) {
    const key = document.createElement('div');
    key.className = 'key'; key.dataset.letter = letter;
    const label = document.createElement('span'); label.textContent = letter; key.appendChild(label);
    els.keys.appendChild(key); keyEls[letter] = key;
  }
  layout(); addEventListener('resize', layout);
  audio = new AudioFX();
  hands = new HandInput({
    video:els.cam, overlay:els.landmarks,
    config:{ ...CONFIG.hand, smooth:IS_TOUCH?.5:CONFIG.hover.smooth, handsUpY:CONFIG.hand.raiseY,
      detectEveryMs:IS_TOUCH?60:30, camW:IS_TOUCH?480:640, camH:IS_TOUCH?360:480 },
  });
  if (!FORCE_MOUSE) hands.preload().catch(()=>{});

  addEventListener('pointermove', e => { mouse.x=e.clientX/innerWidth; mouse.y=e.clientY/innerHeight; mouse.lastMove=performance.now(); });
  addEventListener('pointerdown', () => { mouse.down=true; markActivity(); });
  addEventListener('pointerup', () => { mouse.down=false; });
  addEventListener('keydown', onKeyDown);
  els.startBtn.disabled = false; els.startBtn.textContent = '开启魔法'; els.startBtn.onclick = start;
  document.querySelectorAll('.mode-btn').forEach(btn => btn.onclick=()=>{
    mode=btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(item=>item.classList.toggle('active',item.dataset.mode===mode));
    els.startBtn.textContent=mode==='free'?'开始自由打字':'开启魔法';
    if(state!=='INTRO') beginCurrentMode();
  });
  els.replayBtn.onclick=()=>restartSameMode();
  els.dgAnyway.onclick = () => els.deviceGate.classList.remove('on');
  checkDevice();
  requestAnimationFrame(loop);
}

function checkDevice() {
  const inApp = /MicroMessenger|WeiBo|QQ\/|QQBrowser|TikTok|musical_ly|BytedanceWebview|Lark|XiaoHongShu|xhsdiscover/i.test(navigator.userAgent);
  if (inApp && !params.has('force') && !FORCE_MOUSE) els.deviceGate.classList.add('on');
}

async function start() {
  if (state !== 'INTRO') return;
  els.startBtn.disabled=true; els.startBtn.textContent='唤醒中…'; audio.start();
  if (!FORCE_MOUSE) {
    els.loadNote.classList.add('on');
    const revealCamera = () => els.preview.classList.add('on');
    els.cam.addEventListener('loadeddata', revealCamera, { once:true });
    try { await hands.init(); revealCamera(); hands.setDebug(true); }
    catch (error) {
      console.warn('Camera fallback:', error);
      if (els.cam.srcObject) {
        revealCamera();
        toast('摄像头已开启，但手势模型加载失败');
      } else {
        els.preview.classList.add('camera-error');
        $('cameraPlaceholder').innerHTML='摄像头未开启<br>请在地址栏允许摄像头权限';
        toast('摄像头未开启，请检查浏览器权限');
      }
    }
    els.loadNote.classList.remove('on');
  }
  els.intro.classList.add('hidden');
  await beginCurrentMode();
}

function beginCurrentMode(){ return mode==='free'?beginFree():beginName(); }

async function beginFree() {
  ++runToken; clearTimeout(posterTimer); resetVisuals();
  state='FREE'; current=''; creatorName='YOUR WORDS'; creation=''; finalReply='MADE BY YOU.';
  els.q1.textContent=''; renderAnswers();
  setHint('自由打字 · ☝ 选择 · 🤏 敲字 · ✌ 删除 · 🙌 完成'); markActivity();
}

function restartSameMode(){ beginCurrentMode(); }

async function beginName() {
  const token = ++runToken;
  clearTimeout(posterTimer); resetVisuals();
  state='PRINTING'; current=''; creatorName=''; creation=''; finalReply=''; renderAnswers();
  setHint('☝ 选择字母 · 🤏 捏合敲字 · ✌ 删除 · 🙌 完成');
  await typeText(els.q1, 'WHO ARE YOU?', 62, token, true);
  if (token !== runToken) return;
  state='NAME'; renderAnswers(); markActivity();
}

async function beginCreation() {
  const token = runToken;
  state='PRINTING'; current=''; renderAnswers();
  els.paper.classList.add('scroll');
  await wait(360); await typeText(els.q2, 'WHAT DO YOU WANT TO CREATE?', 42, token, true);
  if (token !== runToken) return;
  els.examples.classList.add('on'); state='CREATE'; renderAnswers();
  setHint('输入一个英文词，例如 MUSIC / GAMES / STORIES / ART'); markActivity();
}

async function finishAnswers() {
  const token = runToken;
  state='REPLYING'; els.examples.classList.remove('on'); renderAnswers();
  finalReply = RESPONSES[creation] || 'MAKE IT REAL.';
  els.paper.classList.add('ending');
  await wait(300); await typeText(els.reply, finalReply, 44, token, true);
  if (token !== runToken) return;
  audio.bell(); await wait(700); ejectPaper();
}

async function doLetter(letter) {
  if (striking || !isTyping() || current.length >= currentLimit()) { if(!striking)rejectInput(); return; }
  striking=true; pressKey(letter);
  const line=state==='CREATE'?els.a2:els.a1;
  await strikeAt(line);
  if(!isTyping()){striking=false;return}
  current += letter; renderAnswers(); markActivity(); striking=false;
}
function doSpace() {
  if (!isTyping() || !current || current.endsWith(' ') || current.length >= currentLimit()) return;
  if (state === 'NAME' && current.includes(' ')) { rejectInput(); return; }
  current += ' '; audio.space(); renderAnswers(); markActivity();
}
function doDelete() {
  if (!isTyping() || !current) return;
  current = current.slice(0,-1); audio.remove(); renderAnswers(); markActivity();
}
function doComplete() {
  if (state === 'POSTER') { restartSameMode(); return; }
  if (!isTyping() || striking) return;
  const value = current.trim().replace(/\s+/g,' ');
  if (!value) { toast('请先输入内容'); rejectInput(); return; }
  audio.complete();
  if (state === 'NAME') { creatorName=value; current=''; renderAnswers(); beginCreation(); }
  else if (state === 'CREATE') { creation=value; current=''; renderAnswers(); finishAnswers(); }
  else if (state === 'FREE') { creation=value; current=''; renderAnswers(); ejectPaper(); }
}

function renderAnswers() {
  const firstLine=state==='FREE'?current:(creatorName || (state==='NAME'?current:''));
  els.a1.innerHTML = `${escapeHtml(firstLine)}${(state==='NAME'||state==='FREE')?'<span class="printCaret" aria-hidden="true"></span>':''}`;
  els.a2.innerHTML = `${escapeHtml(creation || (state==='CREATE'?current:''))}${state==='CREATE'?'<span class="printCaret" aria-hidden="true"></span>':''}`;
  requestAnimationFrame(positionActiveTypebar);
}
function isTyping(){ return state==='NAME' || state==='CREATE' || state==='FREE'; }
function currentLimit(){ return state==='FREE'?48:(state==='NAME'?CONFIG.limits.name:CONFIG.limits.creation); }
function rejectInput(){ els.paper.animate([{transform:'translateX(-50%)'},{transform:'translateX(calc(-50% - 5px))'},{transform:'translateX(calc(-50% + 5px))'},{transform:'translateX(-50%)'}],{duration:180}); audio.remove(); }
function pressKey(letter){ const el=keyEls[letter]; el.classList.add('down'); setTimeout(()=>el.classList.remove('down'),130); }

async function typeText(el, text, speed, token, playSound=false) {
  let printed='';
  el.innerHTML='<span class="printCaret" aria-hidden="true"></span>';
  positionTypebar(el);
  for (const char of text) {
    if (token !== runToken) return;
    if(char!==' ') await strikeAt(el,playSound);
    printed += char;
    el.innerHTML=`${escapeHtml(printed)}<span class="printCaret" aria-hidden="true"></span>`;
    positionTypebar(el);
    await wait(speed);
  }
  el.textContent=text;
}

async function strikeAt(line,withSound=true){
  positionTypebar(line);
  const caret=line.querySelector('.printCaret');
  const paperBox=els.paper.getBoundingClientRect();
  const target=(caret||line).getBoundingClientRect();
  els.typebar.style.left=`${target.right-paperBox.left}px`;
  els.typebar.style.top=`${target.bottom-paperBox.top-3}px`;
  els.typebar.classList.add('ready');
  els.typebar.classList.remove('fire'); void els.typebar.offsetWidth; els.typebar.classList.add('fire');
  if(withSound)audio.click();
  await wait(240);
}

function positionTypebar(line){
  if(!line)return;
  const caret=line.querySelector('.printCaret');
  const target=(caret||line).getBoundingClientRect(),paperBox=els.paper.getBoundingClientRect();
  els.typebar.style.left=`${target.right-paperBox.left}px`;
  els.typebar.style.top=`${target.bottom-paperBox.top-3}px`;
  els.typebar.classList.add('ready');
}

function positionActiveTypebar(){
  if(state==='CREATE')positionTypebar(els.a2);
  else if(state==='NAME'||state==='FREE')positionTypebar(els.a1);
}

function ejectPaper() {
  state='EJECTING'; setHint(''); els.typebar.classList.remove('ready','fire'); els.keys.style.opacity='.25'; els.scene.classList.add('shake');
  audio.roller(); els.paper.classList.add('ejecting');
  setTimeout(()=>audio.eject(),420);
  setTimeout(showPoster,1400);
}
function showPoster() {
  state='POSTER'; els.scene.classList.remove('shake'); els.scene.classList.add('poster-mode');
  audio.report();
  els.paper.className='poster';
  const serial=(Number(localStorage.getItem('creatorSerial')||0)+1); localStorage.setItem('creatorSerial',String(serial));
  els.posterName.textContent=creatorName; els.posterCreation.textContent=creation;
  els.posterReply.textContent=finalReply; els.posterSerial.textContent=`CREATOR No. ${String(serial).padStart(4,'0')}`;
  setTimeout(()=>{ els.paper.classList.add('stamped'); audio.stamp(); },750);
  setTimeout(()=>els.restartNote.classList.add('on'),1500);
  setTimeout(()=>els.replayBtn.classList.add('on'),1500);
  posterTimer=setTimeout(restartSameMode,CONFIG.timings.posterHold*1000);
}
function resetVisuals() {
  els.scene.classList.remove('poster-mode','shake'); els.paper.className=''; els.keys.style.opacity='1';
  els.restartNote.classList.remove('on'); els.replayBtn.classList.remove('on'); els.typebar.classList.remove('ready','fire'); els.q1.textContent=''; els.q2.textContent=''; els.a1.textContent=''; els.a2.textContent=''; els.reply.textContent=''; els.examples.classList.remove('on');
  for (const el of Object.values(keyEls)) el.classList.remove('hover','down');
}

function layout() {
  const W=innerWidth,H=innerHeight,A=1672/941;
  dispW=Math.max(W,H*A); dispH=Math.max(H,W/A); offX=(W-dispW)/2; offY=(H-dispH)/2;
  document.documentElement.style.setProperty('--key-size',`${.0545*dispW}px`);
  document.documentElement.style.setProperty('--key-font-size',`${.0295*dispW}px`);
  for (const [letter,[x,y]] of Object.entries(CONFIG.letters)) {
    keyEls[letter].style.left=`${offX+x*dispW}px`; keyEls[letter].style.top=`${offY+y*dispH}px`;
  }
}
function letterScreen(letter){ const [x,y]=CONFIG.letters[letter]; return [offX+x*dispW,offY+y*dispH]; }
function getInput(now) {
  if (hands.tracking && hands.state.present) return {...hands.state};
  return {present:mouse.down||now-mouse.lastMove<3000,x:mouse.x,y:mouse.y,pinch:mouse.down,thumbsUp:false,fist:false,cross:false,handsUp:false};
}
function loop(now) {
  window.__creatorState=state; window.__creatorCurrent=current;
  requestAnimationFrame(loop); const dt=Math.min(lastFrame?(now-lastFrame)/1000:.016,.05); lastFrame=now;
  hands.update(now); const input=getInput(now); updateInput(dt,input);
  if (DEBUG) { els.hud.style.display='block'; els.hud.textContent=`${state} · ${hovered||'-'} · ${current} · ${(1/dt).toFixed(0)}fps`; }
  if (isTyping() && now-lastActivity>CONFIG.timings.idleReset*1000) beginCurrentMode();
}
function updateInput(dt,input) {
  const px=input.x*innerWidth,py=input.y*innerHeight;
  if (input.present && isTyping()) {
    els.cursor.classList.add('on');
    els.cursor.style.left=`${px}px`;
    els.cursor.style.top=`${py}px`;
    els.cursor.classList.toggle('pinch',input.pinch);
  } else {
    els.cursor.classList.remove('on');
  }

  // 完全沿用原字母墙的最近字母 + 迟滞算法。
  // 捏合期间冻结 hover，避免食指向拇指移动时跳到相邻键帽。
  let next=hovered;
  if (!input.present || !isTyping()) {
    next=null;
  } else if (!input.fist && !input.pinch) {
    const radius=CONFIG.hover.radius*dispW;
    let bestDistance=radius,bestLetter=null,currentDistance=Infinity;
    for (const letter of Object.keys(CONFIG.letters)) {
      const [x,y]=letterScreen(letter);
      const distance=Math.hypot(px-x,py-y);
      if (letter===hovered) currentDistance=distance;
      if (distance<bestDistance) { bestDistance=distance; bestLetter=letter; }
    }
    next=bestLetter;
    if (hovered && next && next!==hovered && currentDistance<radius*1.4 && bestDistance>currentDistance*CONFIG.hover.sticky) {
      next=hovered;
    }
  }
  if (next!==hovered) {
    if (hovered) keyEls[hovered].classList.remove('hover');
    hovered=next;
    if (hovered) keyEls[hovered].classList.add('hover');
  }

  if (!input.pinch) stableHover=hovered;
  if (input.pinch && !prevPinch && stableHover) doLetter(stableHover);
  prevPinch=input.pinch;

  thumbCooldown=Math.max(0,thumbCooldown-dt);
  if (input.thumbsUp && !prevThumb && thumbCooldown<=0) {
    doSpace();
    thumbCooldown=CONFIG.gestures.thumbCooldown;
  }
  prevThumb=input.thumbsUp;

  if (input.cross) {
    scissorTime+=dt;
    if (!scissorFired && scissorTime>=CONFIG.hand.scissorHold) {
      doDelete();
      scissorFired=true;
    }
  } else {
    scissorTime=0;
    scissorFired=false;
  }

  if (input.handsUp) {
    handsGrace=0;
    handsUpTime+=dt;
    if (handsUpTime>=CONFIG.gestures.handsUpHold) {
      handsUpTime=0;
      doComplete();
    }
  } else if (handsUpTime>0 && handsGrace<CONFIG.gestures.handsUpGrace) {
    handsGrace+=dt;
  } else {
    handsUpTime=0;
    handsGrace=0;
  }
}

function onKeyDown(e) {
  if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='m') { e.preventDefault(); audio.setMuted(!audio.muted); toast(audio.muted?'已静音':'声音已开启'); return; }
  if (!isTyping() && state!=='POSTER') return;
  if (/^[a-z]$/i.test(e.key)) doLetter(e.key.toUpperCase());
  else if (e.key==='Backspace') doDelete();
  else if (e.key===' ') { e.preventDefault(); doSpace(); }
  else if (e.key==='Enter') doComplete();
}
function markActivity(){lastActivity=performance.now();}
function setHint(text){els.hint.textContent=text;}
function toast(text){els.toast.textContent=text;els.toast.classList.add('on');setTimeout(()=>els.toast.classList.remove('on'),2400);}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function escapeHtml(value){return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
