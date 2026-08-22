import {
  Bot,
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
  DAILY_FLOORS,
  dailyDay,
  dailySeed,
  MODE_GAUNTLET,
  MODE_HAUL,
  NetClient,
  TILE,
  analyseLevel,
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
import { desktopAvailable, hostLocalServer, onHostReady, onSteamJoinRequest, setRichPresence, steamName, stopLocalServer } from './steam.js';
import { buildScreen, tickPreviews, type ScreenId } from './ui/screens.js';

export const VERSION = '1.0.0';

/** Contextual coaching, shown once each until the player has seen them all. */
/**
 * Hints, and the one that had to stop being on a timer.
 *
 * Everything here fires on the clock, which is fine for the things a player
 * will meet in the first thirty seconds whatever they do. The boost is not one
 * of those: it is the only move in the game that needs both haulers standing
 * still in the right place at once, so nobody stumbles into it, and it is the
 * only move without which the tower cannot be finished. Explaining it at
 * fifteen seconds, next to a gate they will not reach for another four minutes,
 * is the same as not explaining it. So its condition is a place rather than a
 * time — standing under one, looking up at a step that is not there.
 */
const HINTS: { id: string; text: string; when: (w: World, tick: number, atGate: boolean) => boolean }[] = [
  { id: 'move', text: 'Move with A and D. Jump with SPACE.', when: (_w, t) => t > 90 && t < 480 },
  { id: 'rope', text: 'The rope will not stretch past its limit — run too far and you drag your partner with you.', when: (_w, t) => t > 520 && t < 900 },
  { id: 'grip', text: 'Hold SHIFT to brace in place. Your partner can then swing from you.', when: (_w, t) => t > 940 && t < 1400 },
  { id: 'reel', text: 'Hold F to reel yourself along the rope toward your partner.', when: (_w, t) => t > 1440 && t < 1900 },
  { id: 'cargo', text: 'The crate takes damage when it hits things. Reach a checkpoint to repair it.', when: (w) => w.cargo.hp < 70 },
  {
    id: 'boost',
    text: 'Nobody climbs this alone. One of you holds SHIFT to brace; the other stands against them and jumps.',
    when: (_w, _t, atGate) => atGate,
  },
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
  /** Local play with a bot on the second rope end rather than a second person. */
  get botPartner(): boolean {
    return this.settings.botPartner;
  }

  set botPartner(value: boolean) {
    this.settings.botPartner = value;
    this.persist();
  }

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
  private statSnapshot = { deaths: 0, breaks: 0, betrayals: 0, boosts: 0, bonds: 0, best: 0 };
  private runCounted = false;
  private paused = false;
  private autoNamed = false;
  /** Port of the server this client started, or 0. */
  hostedPort = 0;

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
    this.placeAttract();
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
      this.stopHosting();
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
      // Escape is how everyone leaves a screen. On the results screen it used
      // to do nothing at all, which is a bad note to end a run on.
      else if (this.screen === 'results') this.leave();
    }

    const session = this.net ?? this.local;
    if (!session) {
      this.runAttract(dt);
      return;
    }

    const inMenu = this.screen !== 'none';
    // The arrow keys belong to player two whenever player two is a person.
    // Everywhere else they are a convenience for whoever is holding the
    // keyboard alone.
    this.input.soloKeyboard = this.net !== null || this.botPartner;
    const masks: number[] = [0, 0];
    if (!inMenu) {
      if (this.net) masks[Math.max(0, this.net.localIndex)] = this.input.mask(0);
      else {
        masks[0] = this.input.mask(0);
        // The bot overrides slot two inside the session anyway; not reading
        // the keys for it keeps the arrow keys from looking half-connected.
        if (!this.botPartner) masks[1] = this.input.mask(1);
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

    // `finishedRun` is the latch. Without it, any screen change away from the
    // results screen is undone on the very next frame — the session is still
    // sitting there in phase 'ended' — which traps the player on the results
    // of a run they already finished and re-counts the finish every time.
    if (this.local && this.local.phase === 'ended' && !this.finishedRun && this.screen !== 'results') {
      this.finishLocalRun();
    }
  }

  /**
   * Stand the attract pair near the top of the tower rather than at the spawn.
   *
   * The campaign starts in the Yard, which is the palest biome in the game, and
   * the menu panel is paper — so pale-on-pale behind a dim left the backdrop as
   * grey mush with nothing readable in it. The Spire is the dark one, and a
   * near-black city behind a paper-and-hazard panel is the same inversion the
   * whole art direction is built on.
   */
  private placeAttract(): void {
    const world = this.attract.world;
    const level = this.attract.ctx.level;
    const y = level.heightPx * 0.06;
    for (let i = 0; i < 2; i++) {
      const p = world.players[i];
      p.x = level.spawnX + (i ? 30 : -30);
      p.y = y;
      p.vx = 0;
      p.vy = 0;
    }
    const n = world.ropeX.length;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t;
      world.ropeY[i] = y;
      world.ropePX[i] = world.ropeX[i];
      world.ropePY[i] = y;
    }
    world.cargo.x = level.spawnX;
    world.cargo.y = y + 40;
    world.cargo.px = world.cargo.x;
    world.cargo.py = world.cargo.y;
    world.spawnX = level.spawnX;
    world.spawnY = y;
    this.renderer.reset(world);
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
    if (this.attract.world.tick > 3600) {
      this.attract.restart(0x51ade);
      this.placeAttract();
    }
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
    const atGate = this.underGate(world);
    for (const hint of HINTS) {
      if (this.shownHints.has(hint.id)) continue;
      if (!hint.when(world, tick, atGate)) continue;
      this.shownHints.add(hint.id);
      save('hints', [...this.shownHints]);
      this.hintText = hint.text;
      this.hintStrength = 1.9;
      break;
    }
  }

  /**
   * Is either hauler standing at the bottom of a two-person step?
   *
   * The gate cells come from the same fill that proves the tower climbable, so
   * this can never drift from where the gates actually are. Cached per level
   * because the fill is about thirty milliseconds and the level does not move.
   */
  private underGate(world: World): boolean {
    const level = (this.net ?? this.local)?.ctx?.level;
    if (!level) return false;
    if (this.gatesFor !== level) {
      this.gatesFor = level;
      this.gateCells = analyseLevel(level, { coop: true }).gates;
    }
    for (const g of this.gateCells) {
      const gx = g.x * TILE + TILE / 2;
      const gy = (g.y + 1) * TILE;
      for (const p of world.players) {
        if (p.dead || p.grounded !== 1) continue;
        // Below it and near it: standing where the missing foothold would be
        // seen from, not merely somewhere in the same room.
        const dy = p.y - gy;
        if (dy > TILE * 2 && dy < TILE * 8 && Math.abs(p.x - gx) < TILE * 5) return true;
      }
    }
    return false;
  }

  /** Public so `npm run shots` can stage a picture at one. */
  gateCells: { x: number; y: number }[] = [];
  private gatesFor: unknown = null;

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
    if (world.boosts > this.statSnapshot.boosts) {
      this.profile.boosts += world.boosts - this.statSnapshot.boosts;
      this.statSnapshot.boosts = world.boosts;
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
      : [this.settings.playerName || 'PLAYER ONE', this.local?.bots[1] ? 'AUTOHAULER' : 'PLAYER TWO'];
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
      this.targetTicks = client.mode === MODE_HAUL ? this.profile.bestCampaignTicks : 0;
      this.profile.finishes++;
      this.recordBest(result, client.mode, client.towerLength);
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

  /**
   * Start the bundled matchmaking server inside the desktop shell and point
   * this client at it. Useful on a LAN, and a real fallback if the public
   * server is unreachable — the friend connects to this machine's address.
   */
  async hostLocally(): Promise<void> {
    if (!desktopAvailable()) {
      toast('Only the desktop build can host a server');
      return;
    }
    this.connectingLabel = 'Starting a server on this machine…';
    this.show('connecting');
    const result = await hostLocalServer();
    if (!result) {
      this.fail('This build could not start a local server.');
      return;
    }
    this.settings.serverUrl = result.url;
    this.hostedPort = result.port;
    this.applySettings();
    toast(`Hosting on port ${result.port}`);
    this.connect(INTENT_CREATE);
  }

  stopHosting(): void {
    if (this.hostedPort === 0) return;
    stopLocalServer();
    this.hostedPort = 0;
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

  /**
   * True while the current local run is today's daily tower.
   *
   * The daily is a Gauntlet on a fixed seed, so nothing about the match itself
   * distinguishes it — the flag is what lets the results screen know which
   * record to write, and it is deliberately cleared by anything that reseeds
   * the tower, because a restart on a fresh random seed is not the daily any
   * more however you got there.
   */
  dailyRun = false;

  /** Today, by the game's reckoning. Exposed so the menus can name it. */
  get today(): number {
    return dailyDay(Date.now());
  }

  startDaily(): void {
    const day = this.today;
    this.startCouch(MODE_GAUNTLET, dailySeed(day), DAILY_FLOORS);
    this.dailyRun = true;
    const d = this.profile.daily;
    if (d.day !== day) {
      // A streak survives one missed day being yesterday and nothing more.
      this.profile.daily = {
        day,
        bestTicks: 0,
        bestCheckpoints: 0,
        attempts: 0,
        streak: d.day === day - 1 ? d.streak + 1 : 1,
      };
    }
    this.profile.daily.attempts++;
    this.persist();
  }

  startCouch(mode = this.lobbyMode, seed = (Math.random() * 0x7fffffff) | 0, floors = this.lobbyTowerLength): void {
    this.audio.unlock();
    this.disposeSession();
    this.resetRunStats();
    this.finishedRun = false;
    this.lastResult = null;
    this.dailyRun = false;
    this.local = new LocalMatch(mode, seed, floors);
    if (this.botPartner) this.local.setBot(1, new Bot(this.local.ctx.level));
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
    // A restart reseeds the tower, so whatever this run is, it is not today's.
    this.dailyRun = false;
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
      boosts: world.boosts,
      bonds: world.bonds,
      checkpoints: world.checkpoint + 1,
    };
    // Read the target *before* recording, so "your best" on the card is the
    // one you were racing rather than the one you just set.
    this.targetTicks = this.dailyRun
      ? this.profile.daily.day === this.today
        ? this.profile.daily.bestTicks
        : 0
      : this.local!.ctx.mode === MODE_HAUL
        ? this.profile.bestCampaignTicks
        : 0;
    if (this.dailyRun) this.recordDaily(this.lastResult);
    this.recordBest(this.lastResult, this.local!.ctx.mode, this.lobbyTowerLength);
    this.checkAchievements(world);
    this.persist();
    this.show('results');
  }

  /**
   * Fold a finished daily run into today's record.
   *
   * Best time only counts a run that reached the top; a run that ended early
   * has a `finishTick` too, and it is the tick it gave up on, which would
   * otherwise post a world record for quitting.
   */
  /**
   * Fold a finished run into the profile's personal bests.
   *
   * `bestCampaignTicks` and `bestGauntletHeight` have been in the profile since
   * it was written and nothing ever set them or read them — a personal best the
   * game kept for nobody. Beating your own time with the same friend is the
   * whole return loop in a game like this, and it was the one thing the results
   * screen could not tell you.
   */
  private recordBest(result: MatchResult, mode: number, floors: number): void {
    if (!this.finishedRun) return;
    if (mode === MODE_HAUL) {
      const best = this.profile.bestCampaignTicks;
      if (best === 0 || result.finishTick < best) this.profile.bestCampaignTicks = result.finishTick;
    } else if (floors > this.profile.bestGauntletHeight) {
      this.profile.bestGauntletHeight = floors;
    }
  }

  /** The time to beat for the run just finished, in ticks, or 0 if there isn't one. */
  targetTicks = 0;

  private recordDaily(result: MatchResult): void {
    const d = this.profile.daily;
    if (d.day !== this.today) return;
    d.bestCheckpoints = Math.max(d.bestCheckpoints, result.checkpoints);
    if (this.finishedRun && (d.bestTicks === 0 || result.finishTick < d.bestTicks)) {
      d.bestTicks = result.finishTick;
    }
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
    this.statSnapshot = { deaths: 0, breaks: 0, betrayals: 0, boosts: 0, bonds: 0, best: 0 };
    this.runCounted = false;
  }
}

export { buildCampaign, MODE_GAUNTLET, MODE_HAUL, INTENT_CREATE, INTENT_JOIN, INTENT_QUICKPLAY };
