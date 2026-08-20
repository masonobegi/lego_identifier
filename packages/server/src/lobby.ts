import { DEFAULT_TOWER_LENGTH, MODE_GAUNTLET, isValidRoomCode } from '@haulmates/core';
import { config } from './config.js';
import { log } from './log.js';
import { Room, makeRoomCode } from './room.js';

/** Owns every live room and drives them all from one fixed-rate clock. */
export class Lobby {
  readonly rooms = new Map<string, Room>();
  private timer: NodeJS.Timeout | null = null;
  private nextTickAt = 0;
  /** Ticks the loop had to skip because the process fell behind. */
  droppedTicks = 0;

  create(mode: number, seed: number, towerLength: number, isPublic: boolean): Room | null {
    if (this.rooms.size >= config.maxRooms) return null;
    const code = makeRoomCode((c) => this.rooms.has(c));
    const room = new Room(code, mode, seed, clampTowerLength(towerLength));
    room.isPublic = isPublic;
    this.rooms.set(code, room);
    log.info(`room ${code}: created (mode=${mode} seed=${seed} public=${isPublic})`);
    return room;
  }

  get(code: string): Room | undefined {
    return isValidRoomCode(code) ? this.rooms.get(code) : undefined;
  }

  /** An open public room waiting for a partner, preferring the oldest. */
  findQuickplay(mode: number): Room | undefined {
    let best: Room | undefined;
    for (const room of this.rooms.values()) {
      if (!room.isPublic) continue;
      if (room.mode !== mode) continue;
      if (room.state !== 'lobby') continue;
      if (room.playerCount !== 1) continue;
      if (!best || room.createdAt < best.createdAt) best = room;
    }
    return best;
  }

  destroy(code: string): void {
    if (this.rooms.delete(code)) log.info(`room ${code}: destroyed`);
  }

  /** Reap rooms that have been empty past the reconnect grace period. */
  sweep(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      if (room.playerCount > 0) continue;
      if (room.emptySince === 0) {
        room.emptySince = now;
        continue;
      }
      if (now - room.emptySince > config.roomGraceMs) this.destroy(code);
    }
  }

  start(): void {
    if (this.timer) return;
    const stepMs = 1000 / 60;
    this.nextTickAt = Date.now();
    const loop = (): void => {
      const now = Date.now();
      let guard = 0;
      while (now >= this.nextTickAt && guard < 8) {
        for (const room of this.rooms.values()) room.tickOnce();
        this.nextTickAt += stepMs;
        guard++;
      }
      if (now >= this.nextTickAt) {
        // The process stalled long enough that catching up tick-by-tick would
        // make things worse. Skip ahead instead of spiralling.
        const behind = Math.floor((now - this.nextTickAt) / stepMs);
        this.droppedTicks += behind;
        this.nextTickAt = now + stepMs;
        if (behind > 30) log.warn(`server fell behind by ${behind} ticks`);
      }
      this.timer = setTimeout(loop, Math.max(0, this.nextTickAt - Date.now()));
    };
    loop();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  stats(): Record<string, unknown> {
    let players = 0;
    let running = 0;
    for (const room of this.rooms.values()) {
      players += room.playerCount;
      if (room.state === 'running') running++;
    }
    return { rooms: this.rooms.size, running, players, droppedTicks: this.droppedTicks };
  }
}

export function clampTowerLength(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TOWER_LENGTH;
  return Math.max(3, Math.min(40, Math.floor(n)));
}

export { MODE_GAUNTLET };
