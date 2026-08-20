import {
  DEFAULT_TOWER_LENGTH,
  IN_GRIP,
  IN_JUMP,
  IN_LEFT,
  IN_REEL,
  IN_RIGHT,
  INTENT_CREATE,
  INTENT_JOIN,
  INTENT_QUICKPLAY,
  LocalMatch,
  MODE_GAUNTLET,
  MODE_HAUL,
  NetClient,
  TILE,
  buildCampaign,
  modeName,
  type MatchResult,
  type SimEvent,
  type World,
} from '@haulmates/core';
import { clear, h, toast } from './dom.js';
import { InputManager } from './input.js';
import { AudioEngine } from './audio/synth.js';
import { Music } from './audio/music.js';
import { Sfx } from './audio/sfx.js';
import { Renderer, type RenderOptions } from './render/renderer.js';
import { PLAYER_COLOURS } from './render/palette.js';
import type { HudState } from './render/hud.js';
import { createWebSocketTransport, normaliseServerUrl } from './net/transport.js';
import {
  DEFAULT_SETTINGS,
  loadProfile,
  loadSettings,
  randomName,
  saveProfile,
  saveSettings,
  type Profile,
  type Settings,
} from './settings.js';
import { load, save } from './storage.js';
import { Achievements, type AchievementDef } from './achievements.js';
import { onHostReady, onSteamJoinRequest, setRichPresence, steamName } from './steam.js';
import { buildScreen, tickPreviews, type ScreenId } from './ui/screens.js';

export const VERSION = '1.0.0';

/** Contextual coaching, shown once each until the player has seen them all. */
const HINTS: { id: string; text: string; when: (w: World, tick: number) => boolean }[] = [
  { id: 'move', text: 'Move with A and D. Jump with SPACE.', when: (_w, t) => t > 90 && t < 480 },
  { id: 'rope', text: 'The rope will not stretch past its limit — run too far and you drag your partner with you.', when: (_w, t) => t > 520 && t < 900 },
  { id: 'grip', text: 'Hold SHIFT to brace in place. Your partner can then swing from you.', when: (_w, t) => t > 940 && t < 1400 },
  { id: 'reel', text: 'Hold F to reel yourself along the rope toward your partner.', when: (_w, t) => t > 1440 && t < 1900 },
  { id: 'cargo', text: 'The crate takes damage when it hits things. Reach a checkpoint to repair it.', when: (w) => w.cargo.hp < 70 },
];

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLElement;
  readonly renderer: Renderer;
  readonly audio = new AudioEngine();
  readonly music: Music;
  readonly sfx: Sfx;
  readonly input = new InputManager();
  readonly achievements: Achievements;
  readonly version = VERSION;

  settings: Settings;
  profile: Profile;

  screen: ScreenId = 'title';
  errorMessage = '';
  connectingLabel = 'Reaching the server…';
  pendingCode = '';
  rebindSlot = 0;

  lobbyMode = MODE_HAUL;
  lobbyTowerLength = DEFAULT_TOWER_LENGTH;

  net: NetClient | null = null;
  local: LocalMatch | null = null;
  lastResult: MatchResult | null = null;
  finishedRun = false;

  attract: LocalMatch;
  private lastFrame = 0;
  private clockSeconds = 0;
  private hintText = '';
  private hintStrength = 0;
  private shownHints = new Set<string>();
  private achievementTimer = 0;
  private statSnapshot = { deaths: 0, breaks: 0, betrayals: 0, bonds: 0, best: 0 };
  private runCounted = false;
  private paused = false;
  private autoNamed = false;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.renderer = new Renderer(canvas);
    this.music = new Music(this.audio);
    this.sfx = new Sfx(this.audio);
    this.settings = loadSettings();
    this.profile = loadProfile();
    // Remember whether the name was invented for them, so a Steam persona can
    // still replace it once the shell reports in.
    this.autoNamed = !this.settings.playerName;
    if (this.autoNamed) this.settings.playerName = steamName() || randomName();
    this.shownHints = new Set(load<string[]>('hints', []));

    this.achievements = new Achievements((def) => this.announceAchievement(def));
    this.achievements.hydrate(load<string[]>('achievements', []));

    this.attract = new LocalMatch(MODE_HAUL, 0x51ade, DEFAULT_TOWER_LENGTH);
    this.renderer.reset(this.attract.world);

    this.input.attach();
    this.applySettings();
    this.wireGlobalEvents();
    this.show('title');
  }

  /* ----------------------------------------------------------- lifecycle */

  private wireGlobalEvents(): void {
    window.addEventListener('resize', () => this.renderer.resize());
    const unlock = (): void => {
      this.audio.unlock();
      this.audio.setVolumes(this.settings.master, this.settings.sfx, this.settings.music);
      if (this.audio.ready) this.music.start(0);
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.audio.suspend();
        this.input.releaseAll();
      } else {
        this.audio.resume();
      }
    });
    window.addEventListener('beforeunload', () => {
      this.persist();
      this.net?.leave();
    });
    onHostReady(() => {
      const persona = steamName();
      if (this.autoNamed && persona) {
        this.settings.playerName = persona;
        this.autoNamed = false;
        this.applySettings();
      }
      if (this.screen === 'title') this.refresh();
    });
    onSteamJoinRequest((code) => {
      this.pendingCode = code;
      this.connect(INTENT_JOIN, code);
    });
  }

  start(): void {
    const frame = (now: number): void => {
      const dt = this.lastFrame === 0 ? 1 / 60 : Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.clockSeconds += dt;
      try {
        this.tick(dt);
      } catch (err) {
        // A rendering fault must never take the whole game down mid-match.
        console.error('frame error', err);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* --------------------------------------------------------------- frame */

  private tick(dt: number): void {
    this.sfx.beginFrame();
    tickPreviews(this.clockSeconds);

    if (this.input.pausePressed()) {
      if (this.screen === 'none') this.show('pause');
      else if (this.screen === 'pause') this.resume();
    }

    const session = this.net ?? this.local;
    if (!session) {
      this.runAttract(dt);
      return;
    }

    const inMenu = this.screen !== 'none';
    const masks: number[] = [0, 0];
    if (!inMenu) {
      if (this.net) masks[Math.max(0, this.net.localIndex)] = this.input.mask(0);
      else {
        masks[0] = this.input.mask(0);
        masks[1] = this.input.mask(1);
      }
    }

    const freezeLocal = this.local !== null && inMenu;
    if (!freezeLocal) session.update(dt * 1000, masks);

    const world = session.world;
    if (!world) return;
    const events = session.drainEvents();
    this.consumeEvents(events, world);
    this.updateHints(world, session.localTick);
    this.trackProfile(world);
    this.updateMusic(world, dt);

    this.renderer.render(dt, {
      world,
      prev: session.prev!,
      alpha: session.alpha,
      level: session.ctx!.level,
      hud: this.hudState(world),
      hats: this.hats(),
      colours: this.displayColours(),
      options: this.renderOptions(),
    });

    this.achievementTimer += dt;
    if (this.achievementTimer > 0.75) {
      this.achievementTimer = 0;
      this.checkAchievements(world);
    }

    if (this.local && this.local.phase === 'ended' && this.screen !== 'results') this.finishLocalRun();
  }

  private runAttract(dt: number): void {
    // Behind the menus the two haulers flail about on the first floor. It is
    // an advert for the game made out of the game.
    const t = this.attract.localTick;
    const chaos = (seed: number): number => {
      const r = (t * seed + seed * 97) % 220;
      let mask = 0;
      if (r < 70) mask |= IN_RIGHT;
      else if (r < 128) mask |= IN_LEFT;
      if (r % 27 < 4) mask |= IN_JUMP;
      if (r % 53 < 8) mask |= IN_GRIP;
      if (r % 41 < 5) mask |= IN_REEL;
      return mask;
    };
    this.attract.update(dt * 1000, [chaos(31), chaos(47)]);
    const events = this.attract.drainEvents();
    this.renderer.consume(events, this.renderOptions());
    for (const e of events) this.playEventSound(e, this.attract.world);
    if (this.attract.world.tick > 3600) this.attract.restart(0x51ade);
    this.renderer.renderAttract(dt, this.attract.ctx.level, this.attract.world, this.attract.prev, this.renderOptions());
  }

  private consumeEvents(events: SimEvent[], world: World): void {
    this.renderer.consume(events, this.renderOptions());
    for (const e of events) this.playEventSound(e, world);
  }

  private playEventSound(e: SimEvent, world: World): void {
    const cam = this.renderer.camera;
    const pan = Math.max(-1, Math.min(1, (e.x - cam.x) / (cam.viewH * 0.9)));
    const distance = Math.abs(e.y - cam.y) / (cam.viewH * 0.9);
    const gain = Math.max(0, 1 - distance * 0.7);
    void world;
    this.sfx.play(e, pan, gain);
  }

  private updateMusic(world: World, dt: number): void {
    void dt;
    const level = (this.net ?? this.local)?.ctx?.level;
    if (!level) return;
    const row = Math.max(0, Math.min(level.h - 1, Math.floor(world.players[0].y / TILE)));
    this.music.setBiome(level.biome[row]);
    const danger = 1 - world.cargo.hp / 100;
    const speed = Math.min(1, Math.hypot(world.players[0].vx, world.players[0].vy) / 900);
    this.music.setIntensity(0.35 + danger * 0.4 + speed * 0.25);
  }

  private updateHints(world: World, tick: number): void {
    if (this.hintStrength > 0) this.hintStrength -= 0.006;
    if (this.profile.seenTutorial && this.shownHints.size >= HINTS.length) return;
    for (const hint of HINTS) {
      if (this.shownHints.has(hint.id)) continue;
      if (!hint.when(world, tick)) continue;
      this.shownHints.add(hint.id);
      save('hints', [...this.shownHints]);
      this.hintText = hint.text;
      this.hintStrength = 1.9;
      break;
    }
  }

  /* -------------------------------------------------------------- profile */

  private trackProfile(world: World): void {
    const deaths = world.players[0].deaths + world.players[1].deaths;
    if (deaths > this.statSnapshot.deaths) {
      this.profile.deaths += deaths - this.statSnapshot.deaths;
      this.statSnapshot.deaths = deaths;
    }
    if (world.cargoBreaks > this.statSnapshot.breaks) {
      this.profile.cargoBreaks += world.cargoBreaks - this.statSnapshot.breaks;
      this.statSnapshot.breaks = world.cargoBreaks;
    }
    if (world.betrayals > this.statSnapshot.betrayals) {
      this.profile.betrayals += world.betrayals - this.statSnapshot.betrayals;
      this.statSnapshot.betrayals = world.betrayals;
    }
    if (world.bonds > this.statSnapshot.bonds) {
      this.profile.bonds += world.bonds - this.statSnapshot.bonds;
      this.statSnapshot.bonds = world.bonds;
    }
    const level = (this.net ?? this.local)?.ctx?.level;
    if (level) {
      const climbed = (level.heightPx - world.best) / TILE;
      if (climbed > this.statSnapshot.best) {
        this.profile.metres += climbed - this.statSnapshot.best;
        this.statSnapshot.best = climbed;
      }
    }
  }

  private checkAchievements(world: World | null): void {
    const session = this.net ?? this.local;
    const newHats = this.achievements.evaluate({
      profile: this.profile,
      world,
      finished: this.finishedRun,
      mode: session?.ctx?.mode ?? MODE_HAUL,
      towerFloors: this.lobbyTowerLength,
      runDeaths: world ? world.players[0].deaths + world.players[1].deaths : 0,
      runCargoBreaks: world?.cargoBreaks ?? 0,
      runBetrayals: world?.betrayals ?? 0,
      runBonds: world?.bonds ?? 0,
      runSeconds: world ? world.tick / 60 : 0,
      metresThisRun: this.statSnapshot.best,
    });
    if (newHats.length > 0) {
      for (const hat of newHats) {
        if (!this.profile.unlockedHats.includes(hat)) this.profile.unlockedHats.push(hat);
      }
      this.persist();
    }
  }

  private announceAchievement(def: AchievementDef): void {
    toast(`🏆 ${def.name}`);
    this.sfx.fanfare();
    save('achievements', this.achievements.earned);
  }

  persist(): void {
    saveSettings(this.settings);
    saveProfile(this.profile);
    save('achievements', this.achievements.earned);
    this.achievements.pushStats(this.profile);
  }

  /* --------------------------------------------------------------- screens */

  /** Screens that should never be returned to by a Back button. */
  private static readonly TRANSIENT: ScreenId[] = ['none', 'connecting', 'error', 'results'];
  private history: ScreenId[] = [];

  show(id: ScreenId): void {
    if (id === 'title') this.history.length = 0;
    else if (id !== this.screen && !App.TRANSIENT.includes(this.screen)) this.history.push(this.screen);
    this.screen = id;
    this.refresh();
  }

  /** Return to wherever this screen was opened from, not to a fixed screen. */
  back(): void {
    const previous = this.history.pop();
    this.screen = previous ?? 'title';
    this.refresh();
  }

  refresh(): void {
    clear(this.overlay);
    const el = buildScreen(this, this.screen);
    if (!el) return;
    this.overlay.appendChild(h('div', { class: 'backdrop' }));
    this.overlay.appendChild(el);
  }

  resume(): void {
    this.sfx.ui('back');
    this.show('none');
    this.input.releaseAll();
  }

  applySettings(): void {
    this.audio.setVolumes(this.settings.master, this.settings.sfx, this.settings.music);
    saveSettings(this.settings);
  }

  resetSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS, playerName: this.settings.playerName };
    this.applySettings();
    this.refresh();
  }

  private renderOptions(): RenderOptions {
    return {
      highContrast: this.settings.highContrast,
      shake: this.settings.shake,
      reducedFlash: this.settings.reducedFlash,
      showGhostTrail: this.settings.showGhostTrail,
    };
  }

  private hats(): [number, number] {
    if (this.net) {
      return [this.net.peers[0].hat, this.net.peers[1].hat];
    }
    return [this.settings.hat, 0];
  }

  displayColours(): [number, number] {
    if (this.net) {
      const a = this.net.peers[0].colour;
      const b = this.net.peers[1].colour;
      // Never let both haulers wear the same colour: telling each other apart
      // is the difference between teamwork and chaos.
      return [a, b === a ? (b + 1) % PLAYER_COLOURS.length : b];
    }
    const a = this.settings.colour;
    return [a, (a + 1) % PLAYER_COLOURS.length];
  }

  private hudState(world: World): HudState {
    const session = this.net ?? this.local!;
    const names: [string, string] = this.net
      ? [this.net.peers[0].name || 'HAULER ONE', this.net.peers[1].name || 'HAULER TWO']
      : [this.settings.playerName || 'PLAYER ONE', 'PLAYER TWO'];
    const colours = this.displayColours();
    return {
      world,
      level: session.ctx!.level,
      mode: session.ctx!.mode,
      modeName: modeName(session.ctx!.mode),
      localIndex: this.net ? this.net.localIndex : -1,
      names,
      colours: [PLAYER_COLOURS[colours[0] % PLAYER_COLOURS.length].main, PLAYER_COLOURS[colours[1] % PLAYER_COLOURS.length].main],
      elapsedSeconds: world.tick / 60,
      net: this.net
        ? {
            rtt: this.net.rtt,
            rollbacks: this.net.rollbacks,
            worstRollback: this.net.worstRollback,
            tick: this.net.localTick,
            lead: Math.max(0, this.net.localTick - this.net.confirmedTick),
            desyncs: this.net.desyncs,
          }
        : undefined,
      showNetgraph: this.settings.showNetgraph,
      hint: this.hintText,
      hintStrength: Math.min(1, this.hintStrength),
    };
  }

  /* --------------------------------------------------------------- online */

  connect(intent: number, code = ''): void {
    this.audio.unlock();
    this.disposeSession();
    this.errorMessage = '';
    this.finishedRun = false;
    this.lastResult = null;
    this.connectingLabel =
      intent === INTENT_JOIN ? `Looking for haul ${code}…` : intent === INTENT_QUICKPLAY ? 'Finding someone to rope yourself to…' : 'Opening a haul…';
    this.show('connecting');

    const url = normaliseServerUrl(this.settings.serverUrl);
    if (!url) {
      this.fail('No server configured. Set one in Settings.');
      return;
    }

    let transport;
    try {
      transport = createWebSocketTransport(url);
    } catch {
      this.fail(`Could not open a connection to ${url}.`);
      return;
    }

    const client = new NetClient({
      transport,
      name: this.settings.playerName || 'HAULER',
      intent,
      room: code,
      mode: this.lobbyMode,
      towerLength: this.lobbyTowerLength,
      hat: this.settings.hat,
      colour: this.settings.colour,
    });
    this.net = client;

    client.onPeers = () => {
      if (this.screen === 'lobby') this.refresh();
    };
    client.onResult = (result) => {
      this.lastResult = result;
      this.finishedRun = true;
      this.profile.finishes++;
      this.checkAchievements(client.world);
      this.persist();
      this.show('results');
    };
    client.onPhase = (phase) => {
      switch (phase) {
        case 'lobby':
          this.lobbyMode = client.mode;
          this.lobbyTowerLength = client.towerLength;
          this.resetRunStats();
          setRichPresence('In a lobby', client.roomCode);
          this.show('lobby');
          break;
        case 'running':
          if (this.screen !== 'none') this.show('none');
          if (client.world) this.renderer.reset(client.world);
          setRichPresence('Hauling a crate up a tower', client.roomCode);
          if (!this.runCounted) {
            this.runCounted = true;
            this.profile.runs++;
            this.persist();
          }
          break;
        case 'paused':
          toast('Your partner dropped out — waiting for them');
          break;
        case 'ended':
          if (!this.lastResult) this.show('results');
          break;
        case 'error':
          this.fail(client.errorMessage);
          break;
        case 'closed':
          if (this.screen !== 'results' && this.screen !== 'error') {
            this.fail(client.errorMessage || 'The connection to the server was lost.');
          }
          break;
        default:
          break;
      }
    };
  }

  setReady(value: boolean): void {
    this.net?.ready(value);
    this.net?.setCosmetic(this.settings.hat, this.settings.colour);
  }

  rematch(): void {
    this.resetRunStats();
    this.finishedRun = false;
    this.lastResult = null;
    this.net?.rematch();
    this.show('lobby');
  }

  private fail(message: string): void {
    this.errorMessage = message;
    setRichPresence('In the menus', '');
    this.show('error');
    this.sfx.ui('error');
  }

  /* ---------------------------------------------------------------- local */

  startCouch(): void {
    this.audio.unlock();
    this.disposeSession();
    this.resetRunStats();
    this.finishedRun = false;
    this.lastResult = null;
    const seed = (Math.random() * 0x7fffffff) | 0;
    this.local = new LocalMatch(this.lobbyMode, seed, this.lobbyTowerLength);
    this.renderer.reset(this.local.world);
    this.profile.runs++;
    this.persist();
    this.show('none');
  }

  restartLocal(): void {
    if (!this.local) {
      this.startCouch();
      return;
    }
    this.resetRunStats();
    this.finishedRun = false;
    this.lastResult = null;
    this.local.restart((Math.random() * 0x7fffffff) | 0);
    this.renderer.reset(this.local.world);
    this.show('none');
  }

  private finishLocalRun(): void {
    const world = this.local!.world;
    this.finishedRun = true;
    this.profile.finishes++;
    this.lastResult = {
      finishTick: world.finishTick,
      deaths: [world.players[0].deaths, world.players[1].deaths],
      cargoBreaks: world.cargoBreaks,
      betrayals: world.betrayals,
      bonds: world.bonds,
      checkpoints: Math.max(0, world.checkpoint),
    };
    this.checkAchievements(world);
    this.persist();
    this.show('results');
  }

  leave(): void {
    this.disposeSession();
    setRichPresence('In the menus', '');
    this.show('title');
  }

  /** Exposed for the end-to-end tests: proves the menu backdrop is simulating. */
  get attractTick(): number {
    return this.attract.localTick;
  }

  private disposeSession(): void {
    this.net?.dispose();
    this.net = null;
    this.local?.dispose();
    this.local = null;
    this.runCounted = false;
    this.paused = false;
    void this.paused;
    this.renderer.reset(this.attract.world);
  }

  private resetRunStats(): void {
    this.statSnapshot = { deaths: 0, breaks: 0, betrayals: 0, bonds: 0, best: 0 };
    this.runCounted = false;
  }
}

export { buildCampaign, MODE_GAUNTLET, MODE_HAUL, INTENT_CREATE, INTENT_JOIN, INTENT_QUICKPLAY };
