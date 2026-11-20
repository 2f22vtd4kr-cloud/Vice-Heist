export type Role = 'CREW' | 'MOLE';
export type Phase = 'LOBBY' | 'PLAYING' | 'MEETING' | 'GAME_OVER';
export type Player = { id:string; name:string; color:string; x:number; y:number; alive:boolean; role:Role; bot:boolean; tasks:number; lastMove:number; cooldownUntil:number; emergencyUsed:boolean };
export type PublicPlayer = Omit<Player,'role'|'emergencyUsed'|'lastMove'|'cooldownUntil'>;
export type Task = { id:string; label:string; x:number; y:number; done:boolean; zone:number };
export type Body = { id:string; name:string; x:number; y:number; reported:boolean };
export type Snapshot = { code:string; phase:Phase; players:PublicPlayer[]; selfRole?:Role; tasks:Task[]; taskTotal:number; bodies:Body[]; meeting?:{reason:string; votes:Record<string,string>; endsAt:number}; winner?:'CREW'|'MOLE'; sabotage?:{kind:string;endsAt:number}; emergencyCooldownUntil:number; selfCooldownUntil:number; selfEmergencyUsed:boolean };
