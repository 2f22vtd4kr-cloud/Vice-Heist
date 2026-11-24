type SoundEvent = 'roundStart'|'kill'|'death'|'bodyFound'|'crewWin'|'moleWin'|'task'|'meeting'|'sabotage'|'footstepCarpet'|'footstepWood'|'footstepTile'|'footstepMetal';
type Zone = 'lounge'|'suite'|'pool'|'garage'|'server'|'generator'|'dock'|'terrace';
const CUES: Record<SoundEvent, number[]> = {
  roundStart:[392,523,659], kill:[196,147,110], death:[440,349,262], bodyFound:[587,494,392],
  crewWin:[523,659,784,1047], moleWin:[220,196,147,110], task:[659,784], meeting:[330,440],
  sabotage:[164,123,82], footstepCarpet:[90], footstepWood:[125], footstepTile:[155], footstepMetal:[210],
};
const ZONES: {name:Zone;x:number;y:number;freq:number;kind:'hum'|'water'|'city'|'server'}[] = [
  {name:'lounge',x:2822,y:504,freq:118,kind:'hum'},
  {name:'suite',x:5200,y:560,freq:76,kind:'hum'},
  {name:'pool',x:6600,y:500,freq:220,kind:'water'},
  {name:'garage',x:616,y:2831,freq:58,kind:'hum'},
  {name:'server',x:2750,y:2800,freq:92,kind:'server'},
  {name:'generator',x:4905,y:2910,freq:54,kind:'hum'},
  {name:'dock',x:7172,y:2401,freq:180,kind:'water'},
  {name:'terrace',x:6900,y:900,freq:140,kind:'city'},
];
export class EstateAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private sfx?: GainNode;
  private ambience?: GainNode;
  private muted = false;
  private effectsVolume = .8;
  private ambienceVolume = .32;
  private loops: {osc:OscillatorNode;gain:GainNode;filter: BiquadFilterNode}[] = [];
  private lastStep = 0;
  private lastZone: Zone | '' = '';
  private getContext() {
    if (!this.context) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return undefined;
      this.context = new Ctor();
      this.master = this.context.createGain(); this.master.gain.value = this.muted ? 0 : 1;
      this.sfx = this.context.createGain(); this.sfx.gain.value = this.effectsVolume;
      this.ambience = this.context.createGain(); this.ambience.gain.value = this.ambienceVolume;
      this.sfx.connect(this.master); this.ambience.connect(this.master); this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }
  unlock() { this.getContext(); }
  setMuted(value:boolean) { this.muted=value; if(this.master)this.master.gain.setTargetAtTime(value?0:1,this.context!.currentTime,.03); }
  setEffectsVolume(value:number) { this.effectsVolume=Math.max(0,Math.min(1,value)); if(this.sfx)this.sfx.gain.setTargetAtTime(this.effectsVolume,this.context!.currentTime,.03); }
  setAmbienceVolume(value:number) { this.ambienceVolume=Math.max(0,Math.min(1,value)); if(this.ambience)this.ambience.gain.setTargetAtTime(this.ambienceVolume,this.context!.currentTime,.08); }
  play(event:SoundEvent) {
    const ctx=this.getContext(); if(!ctx||this.muted||!this.sfx)return;
    const notes=CUES[event]; const now=ctx.currentTime;
    notes.forEach((frequency,index)=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
      osc.type=event.startsWith('footstep')?'triangle':'sine';
      osc.frequency.setValueAtTime(frequency,now+index*.075);
      if(event==='kill'||event==='death'||event==='moleWin')osc.frequency.exponentialRampToValueAtTime(Math.max(40,frequency*.55),now+index*.075+.22);
      filter.type='lowpass';filter.frequency.value=event.startsWith('footstep')?650:1800;
      gain.gain.setValueAtTime(event.startsWith('footstep')?.11:.0001,now+index*.075);
      gain.gain.exponentialRampToValueAtTime(event.startsWith('footstep')?.001:.13,now+index*.075+.012);
      gain.gain.exponentialRampToValueAtTime(.0001,now+index*.075+(event.startsWith('footstep')?.09:.28));
      osc.connect(filter);filter.connect(gain);gain.connect(this.sfx!);osc.start(now+index*.075);osc.stop(now+index*.075+.32);
    });
  }
  step(now:number, surface:'carpet'|'wood'|'tile'|'metal'='tile') {
    if(now-this.lastStep<310)return; this.lastStep=now;
    this.play(surface==='carpet'?'footstepCarpet':surface==='wood'?'footstepWood':surface==='metal'?'footstepMetal':'footstepTile');
  }
  updateWorld(x:number,y:number) {
    const ctx=this.getContext(); if(!ctx||!this.ambience)return;
    const zone=ZONES.reduce((best,z)=>Math.hypot(z.x-x,z.y-y)<Math.hypot(best.x-x,best.y-y)?z:best,ZONES[0]);
    const distance=Math.hypot(zone.x-x,zone.y-y);
    const level=this.ambienceVolume*Math.max(0,1-distance/1500)*.55;
    this.loops.forEach(loop=>loop.gain.gain.setTargetAtTime(0,ctx.currentTime,.25));
    let loop=this.loops.find(item=>item.osc.frequency.value===zone.freq);
    if(!loop){
      const osc=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
      osc.type=zone.kind==='water'?'sawtooth':'sine';osc.frequency.value=zone.freq;
      filter.type='lowpass';filter.frequency.value=zone.kind==='city'?280:zone.kind==='water'?420:zone.kind==='server'?520:190;
      gain.gain.value=0;osc.connect(filter);filter.connect(gain);gain.connect(this.ambience);osc.start();
      loop={osc,gain,filter};this.loops.push(loop);
      if(this.loops.length>8){const old=this.loops.shift()!;old.osc.stop();old.osc.disconnect();old.gain.disconnect();}
    }
    loop.gain.gain.setTargetAtTime(level,ctx.currentTime,.3);
    this.lastZone=zone.name;
  }
  dispose() { this.loops.forEach(x=>x.osc.stop());this.loops=[];void this.context?.close();this.context=undefined; }
}
