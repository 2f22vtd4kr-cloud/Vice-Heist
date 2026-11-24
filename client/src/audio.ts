type SoundEvent = 'roundStart'|'kill'|'death'|'bodyFound'|'crewWin'|'moleWin'|'task'|'meeting'|'sabotage'|'footstepCarpet'|'footstepWood'|'footstepTile'|'footstepMetal'|'weaponCrowbar'|'weaponPistol'|'weaponKnife';
type Surface = 'carpet'|'wood'|'tile'|'metal';
type Zone = {name:string;x:number;y:number;kind:'water'|'city'|'fluorescent'|'server'|'generator'|'lounge';cutoff:number;frequency:number;radius:number};
const CUES: Record<SoundEvent, number[]> = {
  roundStart:[392,494,587,740], kill:[196,247,294], death:[440,370,294,220],
  bodyFound:[587,740,880], crewWin:[523,659,784,988,1175], moleWin:[220,262,311,370],
  task:[659,784,988], meeting:[330,392,494], sabotage:[164,196,247],
  footstepCarpet:[78], footstepWood:[112], footstepTile:[146], footstepMetal:[185], weaponCrowbar:[146,196,247,294], weaponPistol:[110,165,220], weaponKnife:[262,330,392],
};
const ZONES: Zone[] = [
  {name:'lounge',x:2822,y:504,kind:'lounge',cutoff:1150,frequency:174,radius:1250},
  {name:'suite',x:5200,y:560,kind:'fluorescent',cutoff:360,frequency:74,radius:950},
  {name:'pool',x:6600,y:500,kind:'water',cutoff:850,frequency:210,radius:1450},
  {name:'garage',x:616,y:2831,kind:'fluorescent',cutoff:290,frequency:58,radius:1150},
  {name:'server',x:2750,y:2800,kind:'server',cutoff:680,frequency:92,radius:1250},
  {name:'generator',x:4905,y:2910,kind:'generator',cutoff:440,frequency:54,radius:1350},
  {name:'dock',x:7172,y:2401,kind:'water',cutoff:980,frequency:135,radius:1550},
  {name:'terrace',x:6900,y:900,kind:'city',cutoff:310,frequency:118,radius:1500},
];
type AmbientLoop = {source:AudioBufferSourceNode;filter:BiquadFilterNode;gain:GainNode;osc?:OscillatorNode;hum?:GainNode};
export class EstateAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private sfx?: GainNode;
  private ambience?: GainNode;
  private noise?: AudioBuffer;
  private muted=false;
  private effectsVolume=.8;
  private ambienceVolume=.48;
  private loops=new Map<string,AmbientLoop>();
  private lastStep=0;
  private lastZone='';
  private musicElement?:HTMLAudioElement;
  private musicGain?:GainNode;
  private musicFilter?:BiquadFilterNode;
  private musicVolume=.55;
  private musicIndex=0;
  private musicStarted=false;
  private musicFailures=0;
  private readonly musicTracks=['/audio/kleiner-finger.m4a','/audio/rose-bianche.mp3'];
  private getContext() {
    if(!this.context){
      const Ctor=window.AudioContext||(window as any).webkitAudioContext;
      if(!Ctor)return undefined;
      this.context=new Ctor();
      this.master=this.context.createGain();this.master.gain.value=this.muted?0:1;
      this.sfx=this.context.createGain();this.sfx.gain.value=this.effectsVolume;
      this.ambience=this.context.createGain();this.ambience.gain.value=this.ambienceVolume;
      this.sfx.connect(this.master);this.ambience.connect(this.master);this.master.connect(this.context.destination);
      const buffer=this.context.createBuffer(1,this.context.sampleRate*2,this.context.sampleRate);
      const data=buffer.getChannelData(0);
      for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
      this.noise=buffer;
    }
    if(this.context.state==='suspended')void this.context.resume();
    return this.context;
  }
  unlock(){this.getContext();}
  setMuted(value:boolean){this.muted=value;if(this.master&&this.context)this.master.gain.setTargetAtTime(value?0:1,this.context.currentTime,.03);}
  setEffectsVolume(value:number){this.effectsVolume=Math.max(0,Math.min(1,value));if(this.sfx&&this.context)this.sfx.gain.setTargetAtTime(this.effectsVolume,this.context.currentTime,.03);}
  setAmbienceVolume(value:number){this.ambienceVolume=Math.max(0,Math.min(1,value));if(this.ambience&&this.context)this.ambience.gain.setTargetAtTime(this.ambienceVolume,this.context.currentTime,.08);}
  setMusicVolume(value:number){this.musicVolume=Math.max(0,Math.min(1,value));if(this.musicGain&&this.context)this.musicGain.gain.setTargetAtTime(this.musicVolume,this.context.currentTime,.12);}
  startPlaylist(){
    const ctx=this.getContext();if(!ctx||this.musicStarted)return;
    this.musicStarted=true;this.musicFailures=0;
    const audio=new Audio();audio.preload='auto';audio.crossOrigin='anonymous';
    const source=ctx.createMediaElementSource(audio),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    filter.type='lowpass';filter.frequency.value=18_000;gain.gain.value=this.musicVolume;
    source.connect(filter);filter.connect(gain);gain.connect(this.master!);
    this.musicElement=audio;this.musicFilter=filter;this.musicGain=gain;
    audio.addEventListener('playing',()=>{this.musicFailures=0;});
    audio.addEventListener('ended',()=>this.advancePlaylist(false));
    audio.addEventListener('error',()=>this.advancePlaylist(true));
    this.loadMusicTrack();
  }
  private loadMusicTrack(){
    if(!this.musicElement||!this.musicStarted)return;
    this.musicElement.src=this.musicTracks[this.musicIndex];this.musicElement.load();
    const attempt=this.musicElement.play();if(attempt&&typeof attempt.catch==='function')attempt.catch(()=>{});
  }
  private advancePlaylist(failed:boolean){
    if(!this.musicStarted)return;
    if(failed)this.musicFailures++;else this.musicFailures=0;
    if(this.musicFailures>=this.musicTracks.length){this.musicStarted=false;return;}
    this.musicIndex=(this.musicIndex+1)%this.musicTracks.length;this.loadMusicTrack();
  }
  private noiseHit(frequency:number,level:number,duration:number,filterType:BiquadFilterType='bandpass'){
    const ctx=this.context;if(!ctx||!this.noise||!this.sfx)return;
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=this.noise;filter.type=filterType;filter.frequency.value=frequency;filter.Q.value=filterType==='bandpass'?0.8:0.5;
    gain.gain.setValueAtTime(.0001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(level,ctx.currentTime+.006);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+duration);
    source.connect(filter);filter.connect(gain);gain.connect(this.sfx);source.start();source.stop(ctx.currentTime+duration+.02);
  }
  play(event:SoundEvent){
    const ctx=this.getContext(),sfx=this.sfx;if(!ctx||this.muted||!sfx)return;
    const now=ctx.currentTime,isStep=event.startsWith('footstep');
    if(isStep){
      // Short layered impacts replace the synthetic pitched "wood slap".
      const surface=event.slice('footstep'.length).toLowerCase() as Surface;
      const profile=surface==='carpet'?{thump:105,scuff:210,level:.035,filter:'lowpass' as BiquadFilterType,duration:.085}
        :surface==='wood'?{thump:125,scuff:390,level:.045,filter:'lowpass' as BiquadFilterType,duration:.075}
        :surface==='metal'?{thump:145,scuff:1250,level:.042,filter:'bandpass' as BiquadFilterType,duration:.095}
        :{thump:135,scuff:760,level:.04,filter:'bandpass' as BiquadFilterType,duration:.075};
      this.noiseHit(profile.thump,profile.level*.72,.065,'lowpass');
      this.noiseHit(profile.scuff,profile.level,profile.duration,profile.filter);
      return;
    }
    const notes=CUES[event];
    notes.forEach((frequency,index)=>{
      const osc=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
      osc.type=event==='kill'||event==='sabotage'||event==='weaponPistol'?'sawtooth':'triangle';
      osc.frequency.setValueAtTime(frequency,now+index*.055);
      if(event==='kill'||event==='death'||event==='moleWin')osc.frequency.exponentialRampToValueAtTime(Math.max(45,frequency*.72),now+index*.055+.24);
      filter.type='lowpass';filter.frequency.value=event==='kill'||event==='weaponCrowbar'?1500:event==='weaponPistol'?2800:2400;
      gain.gain.setValueAtTime(.0001,now+index*.055);gain.gain.exponentialRampToValueAtTime(.075,now+index*.055+.018);
      gain.gain.exponentialRampToValueAtTime(.0001,now+index*.055+.34);
      osc.connect(filter);filter.connect(gain);gain.connect(sfx);osc.start(now+index*.055);osc.stop(now+index*.055+.38);
    });
    if(event==='kill')this.noiseHit(620,.10,.19,'lowpass');
    else if(event==='bodyFound')this.noiseHit(1450,.045,.12,'bandpass');
    else if(event==='sabotage')this.noiseHit(180,.07,.3,'lowpass');
  }
  step(now:number,surface:Surface='tile'){
    if(now-this.lastStep<320)return;this.lastStep=now;
    this.play(surface==='carpet'?'footstepCarpet':surface==='wood'?'footstepWood':surface==='metal'?'footstepMetal':'footstepTile');
  }
  private createLoop(zone:Zone):AmbientLoop|undefined{
    const ctx=this.context;if(!ctx||!this.noise||!this.ambience)return undefined;
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=this.noise;source.loop=true;filter.type=zone.kind==='water'?'bandpass':'lowpass';filter.frequency.value=zone.cutoff;filter.Q.value=zone.kind==='water'?0.55:0.25;
    gain.gain.value=0;source.connect(filter);filter.connect(gain);gain.connect(this.ambience);source.start();
    let osc:OscillatorNode|undefined,hum:GainNode|undefined;
    if(zone.kind==='fluorescent'||zone.kind==='server'||zone.kind==='generator'||zone.kind==='lounge'){
      osc=ctx.createOscillator();hum=ctx.createGain();osc.type='sine';osc.frequency.value=zone.frequency;hum.gain.value=0;osc.connect(hum);hum.connect(this.ambience!);osc.start();
    }
    return {source,filter,gain,osc,hum};
  }
  updateWorld(x:number,y:number){
    const ctx=this.getContext();if(!ctx||!this.ambience)return;
    let chosen=ZONES[0],distance=Infinity;
    for(const zone of ZONES){const d=Math.hypot(zone.x-x,zone.y-y);if(d<distance){distance=d;chosen=zone;}}
    for(const zone of ZONES){
      let loop=this.loops.get(zone.name);
      if(!loop){const created=this.createLoop(zone);if(created){loop=created;this.loops.set(zone.name,created);}}
      if(!loop)continue;
      const d=Math.hypot(zone.x-x,zone.y-y);
      const attenuation=Math.pow(Math.max(0,1-d/zone.radius),1.7);
      const level=this.ambienceVolume*attenuation*.48;
      loop.gain.gain.setTargetAtTime(level,ctx.currentTime,.32);
      loop.hum?.gain.setTargetAtTime(level*.38,ctx.currentTime,.32);
    }
    const musicDistance=Math.hypot(2822-x,504-y);
    const musicAttenuation=.16+.84*Math.pow(Math.max(0,1-musicDistance/3000),1.25);
    if(this.musicGain)this.musicGain.gain.setTargetAtTime(this.musicVolume*musicAttenuation,ctx.currentTime,.38);
    if(this.musicFilter)this.musicFilter.frequency.setTargetAtTime(550+17_500*musicAttenuation,ctx.currentTime,.42);
    this.lastZone=chosen.name;
  }
  dispose(){
    this.musicStarted=false;this.musicElement?.pause();this.musicElement?.removeAttribute('src');this.musicElement?.load();this.musicElement=undefined;this.musicGain=undefined;this.musicFilter=undefined;
    for(const loop of this.loops.values()){try{loop.source.stop();loop.osc?.stop();}catch{/* already stopped */}}
    this.loops.clear();void this.context?.close();this.context=undefined;this.noise=undefined;
  }
}
