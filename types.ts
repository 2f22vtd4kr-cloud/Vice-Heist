export type Role = 'CREW' | 'MOLE';
export type Phase = 'LOBBY' | 'PLAYING' | 'MEETING' | 'GAME_OVER';
export type Player = {
  id: string; name: string; color: string; x: number; y: number;
  alive: boolean; reported: boolean; role: Role; bot: boolean; tasks: number;
  lastMove: number; cooldownUntil: number; emergencyUsed: boolean;
  socketId?: string; sessionKey?: string; connected?: boolean;
  aiKey?: string; lastChatAt?: number;
};
export type PublicPlayer = Pick<Player, 'id' | 'name' | 'color' | 'x' | 'y' | 'alive' | 'reported' | 'bot' | 'tasks'>;
export type Task = { id: string; label: string; x: number; y: number; done: boolean; zone: number };
export type Meeting = { reason: string; votes: Record<string, string>; endsAt: number };
export type Snapshot = {
  code: string; phase: Phase; players: PublicPlayer[]; selfRole?: Role; isHost: boolean;
  tasks: Task[]; taskTotal: number; meeting?: Meeting; winner?: 'CREW' | 'MOLE';
  sabotage?: { kind: string; endsAt: number };
  selfCooldownUntil: number; selfEmergencyUsed: boolean; emergencyCooldownUntil: number;
};
