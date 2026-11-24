export type Role = 'CREW' | 'MOLE';
export type Weapon = 'crowbar' | 'pistol' | 'knife';
export type Phase = 'LOBBY' | 'PLAYING' | 'MEETING' | 'GAME_OVER';
export type Player = {
  id: string; name: string; color: string; x: number; y: number;
  alive: boolean; reported: boolean; role: Role; bot: boolean; tasks: number; weapon?: Weapon;
  corpseX: number; corpseY: number; movementInputAt: number;
  lastMove: number; moveX: number; moveY: number; movementEpoch: number; movementRequestId: number; cooldownUntil: number; emergencyUsed: boolean;
  socketId?: string; sessionKey?: string; connected?: boolean;
  aiKey?: string; lastChatAt?: number;
};
export type PublicPlayer = Pick<Player, 'id' | 'name' | 'color' | 'x' | 'y' | 'alive' | 'reported' | 'bot' | 'tasks' | 'corpseX' | 'corpseY'>;
export type Task = { id: string; label: string; x: number; y: number; done: boolean; zone: number; challenge?: string };
export type Vent = { id:string; x:number; y:number; sector:number };
export type Meeting = { reason: string; votes: Record<string, string>; endsAt: number };
export type Snapshot = {
  code: string; phase: Phase; players: PublicPlayer[]; selfRole?: Role; isHost: boolean;
  tasks: Task[]; taskTotal: number; vents: Vent[]; selfVentCooldownUntil: number; meeting?: Meeting; winner?: 'CREW' | 'MOLE';
  sabotage?: { kind: string; endsAt: number };
  doorGates: Array<{ id:string; name:string; x1:number; y1:number; x2:number; y2:number }>; 
  lastKill?: { killerId: string; victimId: string; at: number; weapon?: Weapon };
  selfCooldownUntil: number; selfEmergencyUsed: boolean; emergencyCooldownUntil: number;
};
