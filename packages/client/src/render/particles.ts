/** A fixed-capacity particle pool. Presentation only — nothing here can ever
 *  influence the simulation, so it is safe to skip during rollback. */

const MAX = 900;

export const P_DUST = 0;
export const P_SPARK = 1;
export const P_CHUNK = 2;
export const P_SMOKE = 3;
export const P_RING = 4;
export const P_TEXT = 5;

export interface Emit {
  kind?: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  life?: number;
  size?: number;
  colour?: string;
  gravity?: number;
  drag?: number;
  spin?: number;
  text?: string;
}

export class Particles {
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private rot = new Float32Array(MAX);
  private spin = new Float32Array(MAX);
  private gravity = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private kind = new Uint8Array(MAX);
  private colour: string[] = new Array(MAX).fill('#fff');
  private text: string[] = new Array(MAX).fill('');
  private cursor = 0;
  count = 0;

  emit(e: Emit): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.kind[i] = e.kind ?? P_DUST;
    this.x[i] = e.x;
    this.y[i] = e.y;
    this.vx[i] = e.vx ?? 0;
    this.vy[i] = e.vy ?? 0;
    const life = e.life ?? 0.6;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = e.size ?? 3;
    this.colour[i] = e.colour ?? '#ffffff';
    this.gravity[i] = e.gravity ?? 900;
    this.drag[i] = e.drag ?? 0.9;
    this.rot[i] = Math.random() * 6.28;
    this.spin[i] = e.spin ?? (Math.random() - 0.5) * 8;
    this.text[i] = e.text ?? '';
  }

  burst(count: number, base: Emit, spread: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const power = speed * (0.4 + Math.random() * 0.6);
      this.emit({
        ...base,
        vx: (base.vx ?? 0) + Math.cos(angle) * power * spread,
        vy: (base.vy ?? 0) + Math.sin(angle) * power,
        life: (base.life ?? 0.6) * (0.6 + Math.random() * 0.8),
        size: (base.size ?? 3) * (0.6 + Math.random() * 0.8),
      });
    }
  }

  update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      alive++;
      const drag = Math.pow(this.drag[i], dt * 60);
      this.vx[i] *= drag;
      this.vy[i] = this.vy[i] * drag + this.gravity[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
    this.count = alive;
  }

  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    for (let i = 0; i < MAX; i++) {
      const life = this.life[i];
      if (life <= 0) continue;
      const px = this.x[i];
      const py = this.y[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      const t = life / this.maxLife[i];
      const size = this.size[i];
      ctx.globalAlpha = Math.min(1, t * 1.6);
      ctx.fillStyle = this.colour[i];

      switch (this.kind[i]) {
        case P_SPARK: {
          const len = size * (1 + Math.min(3, Math.hypot(this.vx[i], this.vy[i]) / 300));
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(Math.atan2(this.vy[i], this.vx[i]));
          ctx.fillRect(-len, -size * 0.22, len * 2, size * 0.44);
          ctx.restore();
          break;
        }
        case P_CHUNK: {
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(this.rot[i]);
          ctx.fillRect(-size, -size, size * 2, size * 2);
          ctx.restore();
          break;
        }
        case P_SMOKE: {
          ctx.globalAlpha = t * 0.32;
          ctx.beginPath();
          ctx.arc(px, py, size * (2.2 - t), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case P_RING: {
          ctx.globalAlpha = t * 0.7;
          ctx.strokeStyle = this.colour[i];
          ctx.lineWidth = Math.max(1, size * t * 0.5);
          ctx.beginPath();
          ctx.arc(px, py, size * (1 - t) * 4 + 4, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case P_TEXT: {
          ctx.globalAlpha = Math.min(1, t * 2);
          ctx.font = `900 ${size * 6}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = size * 1.4;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.strokeText(this.text[i], px, py);
          ctx.fillText(this.text[i], px, py);
          break;
        }
        default: {
          ctx.beginPath();
          ctx.arc(px, py, size * (0.4 + t * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.life.fill(0);
    this.count = 0;
  }
}
