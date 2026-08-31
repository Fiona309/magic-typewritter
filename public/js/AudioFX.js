// Original procedural WebAudio effects; no third-party or film samples.
export class AudioFX {
  constructor(){ this.ctx=null; this.muted=false; }
  start(){
    if(!this.ctx) this.ctx=new (window.AudioContext||window.webkitAudioContext)();
    if(this.ctx.state==='suspended') this.ctx.resume();
  }
  setMuted(value){ this.muted=value; }
  tone(frequency,duration=.05,type='triangle',gain=.08,delay=0){
    if(!this.ctx||this.muted)return;
    const time=this.ctx.currentTime+delay;
    const oscillator=this.ctx.createOscillator(),amp=this.ctx.createGain();
    oscillator.type=type; oscillator.frequency.setValueAtTime(frequency,time);
    amp.gain.setValueAtTime(gain,time); amp.gain.exponentialRampToValueAtTime(.0001,time+duration);
    oscillator.connect(amp).connect(this.ctx.destination);
    oscillator.start(time); oscillator.stop(time+duration+.02);
  }
  noise(duration=.025,gain=.11,delay=0,frequency=1850){
    if(!this.ctx||this.muted)return;
    const rate=this.ctx.sampleRate,length=Math.ceil(rate*duration);
    const buffer=this.ctx.createBuffer(1,length,rate),data=buffer.getChannelData(0);
    for(let i=0;i<length;i++) data[i]=(Math.random()*2-1)*(1-i/length);
    const source=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),amp=this.ctx.createGain();
    const time=this.ctx.currentTime+delay;
    source.buffer=buffer; filter.type='bandpass'; filter.frequency.value=frequency; filter.Q.value=.8;
    amp.gain.setValueAtTime(gain,time); amp.gain.exponentialRampToValueAtTime(.0001,time+duration);
    source.connect(filter).connect(amp).connect(this.ctx.destination); source.start(time);
  }
  click(){
    const variation=Math.random()*18;
    this.noise(.018,.12,0,1900); this.tone(165+variation,.026,'square',.055);
    this.tone(74+variation*.3,.045,'triangle',.075,.012); this.noise(.014,.055,.022,1100);
  }
  space(){ this.noise(.035,.08); this.tone(105,.07,'triangle',.06); }
  remove(){ this.tone(92,.11,'sawtooth',.045); }
  bell(){ this.tone(1046,.55,'sine',.085); this.tone(1568,.42,'sine',.045,.03); }
  complete(){
    this.noise(.045,.14,0,720);
    for(let i=0;i<7;i++) this.noise(.025,.045,.055+i*.038,980+i*35);
    this.tone(1174,.9,'sine',.095,.34); this.tone(1760,.62,'sine',.045,.37);
  }
  roller(){ for(let i=0;i<9;i++) this.tone(70+i*3,.07,'square',.018,i*.055); }
  eject(){ for(let i=0;i<12;i++) this.tone(105+i*7,.055,'triangle',.022,i*.045); }
  report(){
    this.tone(98,1.8,'sine',.055); this.tone(196,1.5,'triangle',.04,.08);
    [392,494,587,784,988,1175].forEach((frequency,index)=>{
      this.tone(frequency,1.35-index*.08,'sine',.052,index*.18);
      this.tone(frequency*2,1.05,'triangle',.018,index*.18+.035);
    });
    this.noise(.22,.026,.72,2600);
    this.tone(1568,2.1,'sine',.065,1.05); this.tone(2093,1.8,'sine',.038,1.12);
  }
  stamp(){ this.tone(58,.18,'sine',.15); this.tone(41,.22,'triangle',.12); }
}
