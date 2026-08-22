/**
 * Procedural audio.
 *
 * Every sound in the game is synthesised at runtime — there is not a single
 * audio file in the build. That keeps the download tiny, sidesteps sample
 * licensing entirely, and lets sounds respond continuously to the simulation
 * (impact speed bends the pitch of a thud, rope tension colours the twang).
 */

export interface Envelope {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  /** One reverb return per bus. See `buildReverb`. */
  private sfxVerb: DelayNode | null = null;
  private musicVerb: DelayNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volumes = { master: 0.8, sfx: 0.9, music: 0.55 };
  private startedAt = 0;

  /** Browsers only allow audio after a gesture, so this is called from the
   *  first click or keypress and is safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.build();
      this.startedAt = this.ctx.currentTime;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    // A gentle limiter keeps a pile-up of simultaneous impacts from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 12;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);

    this.sfxVerb = this.buildReverb(this.sfxBus);
    this.musicVerb = this.buildReverb(this.musicBus);

    const length = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  /**
   * A short feedback delay standing in for a reverb: far cheaper than a
   * convolver, and the slap-back suits a game set inside a concrete shaft.
   *
   * One per bus, returning into the bus that fed it, rather than one shared
   * return into the master. A single return put the wet half of every impact,
   * yank and break downstream of the SFX fader: dragging sound effects to zero
   * left all of their tails ringing at full level, and a mute that still makes
   * noise is not a mute. The cost of the split is four nodes.
   */
  private buildReverb(bus: GainNode): DelayNode {
    const ctx = this.ctx!;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.16;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.26;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    delay.connect(feedback);
    feedback.connect(damp);
    damp.connect(delay);
    delay.connect(wet);
    wet.connect(bus);
    return delay;
  }

  /**
   * The reverb return sitting behind the same fader as the voice being sent to
   * it. Pan buses are children of the SFX bus, so anything that is not
   * explicitly on the music bus belongs to the SFX return.
   */
  private verbFor(bus: GainNode): DelayNode | null {
    return bus === this.musicBus ? this.musicVerb : this.sfxVerb;
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.volumes = { master, sfx, music };
    if (this.master) this.master.gain.value = master;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    if (this.musicBus) this.musicBus.gain.value = music;
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get uptime(): number {
    return this.ctx ? this.ctx.currentTime - this.startedAt : 0;
  }

  /** A pitched blip with an exponential decay. The workhorse. */
  tone(options: {
    freq: number;
    to?: number;
    dur?: number;
    type?: OscillatorType;
    gain?: number;
    at?: number;
    bus?: GainNode | null;
    send?: number;
    detune?: number;
    attack?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const bus = options.bus ?? this.sfxBus;
    if (!bus) return;
    const t = options.at ?? ctx.currentTime;
    const dur = options.dur ?? 0.15;
    const osc = ctx.createOscillator();
    osc.type = options.type ?? 'square';
    osc.frequency.setValueAtTime(Math.max(20, options.freq), t);
    if (options.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), t + dur);
    }
    if (options.detune) osc.detune.value = options.detune;

    const gain = ctx.createGain();
    const peak = options.gain ?? 0.25;
    const attack = options.attack ?? 0.004;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(gain);
    gain.connect(bus);
    if (options.send) {
      const verb = this.verbFor(bus);
      if (verb) {
        const send = ctx.createGain();
        send.gain.value = options.send;
        gain.connect(send);
        send.connect(verb);
      }
    }
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Filtered noise: impacts, footsteps, wind, debris. */
  noise(options: {
    dur?: number;
    freq?: number;
    to?: number;
    q?: number;
    gain?: number;
    at?: number;
    type?: BiquadFilterType;
    bus?: GainNode | null;
    send?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer) return;
    const bus = options.bus ?? this.sfxBus;
    if (!bus) return;
    const t = options.at ?? ctx.currentTime;
    const dur = options.dur ?? 0.2;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;

    const filter = ctx.createBiquadFilter();
    filter.type = options.type ?? 'bandpass';
    filter.frequency.setValueAtTime(Math.max(40, options.freq ?? 900), t);
    if (options.to !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.to), t + dur);
    }
    filter.Q.value = options.q ?? 1.2;

    const gain = ctx.createGain();
    const peak = options.gain ?? 0.2;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    if (options.send) {
      const verb = this.verbFor(bus);
      if (verb) {
        const send = ctx.createGain();
        send.gain.value = options.send;
        gain.connect(send);
        send.connect(verb);
      }
    }
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private panBuses = new Map<number, GainNode>();

  /**
   * A cached stereo-pan chain. Sounds are bucketed into a handful of pan
   * positions rather than getting a panner each: identical audible result,
   * a fraction of the node churn when a dozen things happen in one tick.
   */
  panBus(pan: number): GainNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return null;
    const bucket = Math.max(-4, Math.min(4, Math.round(pan * 4)));
    let bus = this.panBuses.get(bucket);
    if (!bus) {
      bus = ctx.createGain();
      if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = bucket / 4;
        bus.connect(panner);
        panner.connect(this.sfxBus);
      } else {
        bus.connect(this.sfxBus);
      }
      this.panBuses.set(bucket, bus);
    }
    return bus;
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }
}
