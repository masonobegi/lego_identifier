import {
  DEFAULT_TOWER_LENGTH,
  INTENT_CREATE,
  INTENT_JOIN,
  INTENT_QUICKPLAY,
  MODE_GAUNTLET,
  MODE_HAUL,
  isValidRoomCode,
  normaliseRoomCode,
} from '@haulmates/core';
import { h, toast } from '../dom.js';
import { ACTIONS, ACTION_LABEL, keyName, type Action } from '../input.js';
import { HATS, PLAYER_COLOURS } from '../render/palette.js';
import { drawHat } from '../render/actors.js';
import { drawCharacterPreview } from '../render/preview.js';
import { ACHIEVEMENTS } from '../achievements.js';
import { desktopAvailable, inviteFriend, openExternal, quitGame, steamAvailable } from '../steam.js';
import { formatTime } from '../render/hud.js';
import type { App } from '../app.js';

export type ScreenId =
  | 'none'
  | 'title'
  | 'online'
  | 'join'
  | 'connecting'
  | 'lobby'
  | 'pause'
  | 'results'
  | 'settings'
  | 'controls'
  | 'customise'
  | 'couch'
  | 'achievements'
  | 'error';

const previewCanvases = new Set<{ canvas: HTMLCanvasElement; colour: () => number; hat: () => number }>();

/** Animate every live character portrait; called from the main loop. */
export function tickPreviews(time: number): void {
  for (const entry of previewCanvases) {
    if (!entry.canvas.isConnected) {
      previewCanvases.delete(entry);
      continue;
    }
    drawCharacterPreview(entry.canvas, entry.colour(), entry.hat(), time, drawHat);
  }
}

function preview(colour: () => number, hat: () => number): HTMLCanvasElement {
  const canvas = h('canvas', { width: 108, height: 128 });
  previewCanvases.add({ canvas, colour, hat });
  drawCharacterPreview(canvas, colour(), hat(), 0, drawHat);
  return canvas;
}

function button(
  app: App,
  label: string,
  hint: string,
  onClick: () => void,
  options: { primary?: boolean; icon?: string; key?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  return h(
    'button',
    {
      class: `btn${options.primary ? ' primary' : ''}`,
      disabled: options.disabled ?? false,
      onclick: () => {
        app.sfx.ui('confirm');
        onClick();
      },
    },
    options.icon ? h('span', { class: 'icon' }, options.icon) : null,
    h('span', {}, h('span', { class: 'label' }, label), hint ? h('span', { class: 'hint' }, hint) : null),
    options.key ? h('span', { class: 'k' }, options.key) : null,
  );
}

/** `to` of 'auto' pops the navigation stack instead of jumping to a fixed
 *  screen, so Settings opened from the pause menu returns to the pause menu. */
function backButton(app: App, to: ScreenId | 'auto', label = 'Back'): HTMLButtonElement {
  return h(
    'button',
    {
      class: 'btn ghost',
      onclick: () => {
        app.sfx.ui('back');
        if (to === 'auto') app.back();
        else app.show(to);
      },
    },
    `← ${label}`,
  );
}

export function buildScreen(app: App, id: ScreenId): HTMLElement | null {
  switch (id) {
    case 'title':
      return titleScreen(app);
    case 'online':
      return onlineScreen(app);
    case 'join':
      return joinScreen(app);
    case 'connecting':
      return connectingScreen(app);
    case 'lobby':
      return lobbyScreen(app);
    case 'pause':
      return pauseScreen(app);
    case 'results':
      return resultsScreen(app);
    case 'settings':
      return settingsScreen(app);
    case 'controls':
      return controlsScreen(app);
    case 'customise':
      return customiseScreen(app);
    case 'couch':
      return couchScreen(app);
    case 'achievements':
      return achievementsScreen(app);
    case 'error':
      return errorScreen(app);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------- title */

function titleScreen(app: App): HTMLElement {
  return h(
    'div',
    { class: 'screen narrow' },
    h('h1', { class: 'logo' }, 'HAUL', h('span', { class: 'rope' }, 'MATES')),
    h('p', { class: 'tagline' }, 'A two-player co-op disaster about a rope, a crate, and the end of a friendship.'),
    h(
      'div',
      { class: 'menu' },
      button(app, 'Play online', 'Two players, one rope, anywhere in the world', () => app.show('online'), {
        primary: true,
        icon: '🌐',
      }),
      button(app, 'Couch co-op', 'Two controllers or a shared keyboard on one screen', () => app.show('couch'), {
        icon: '🛋️',
      }),
      button(app, 'How to play', 'Four buttons. Infinite ways to ruin things.', () => app.show('controls'), { icon: '🎮' }),
      button(app, 'Customise', 'Colours and hats you have earned', () => app.show('customise'), { icon: '🎩' }),
      button(app, 'Achievements', `${app.achievements.earned.length} of ${ACHIEVEMENTS.length} earned`, () => app.show('achievements'), { icon: '🏆' }),
      button(app, 'Settings', 'Audio, accessibility, controls, server', () => app.show('settings'), { icon: '⚙️' }),
      desktopAvailable() ? button(app, 'Quit', '', () => quitGame(), { icon: '🚪' }) : null,
    ),
    h(
      'p',
      { class: 'tagline', style: { marginTop: '22px', marginBottom: '0', fontSize: '12px' } },
      `v${app.version}${steamAvailable() ? ' · Steam' : ''} · Best played with someone you can shout at`,
    ),
  );
}

/* ------------------------------------------------------------------ online */

function modeSelector(app: App): HTMLElement {
  const modes: { id: number; name: string; blurb: string }[] = [
    { id: MODE_HAUL, name: 'The Long Haul', blurb: 'The full climb: four biomes, twenty floors, one crate.' },
    { id: MODE_GAUNTLET, name: 'The Gauntlet', blurb: 'A randomly assembled tower. Pick how tall. Regret it.' },
  ];
  return h(
    'div',
    {},
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'Mode'),
      h(
        'div',
        { class: 'menu two' },
        ...modes.map((m) =>
          button(app, m.name, m.blurb, () => {
            app.lobbyMode = m.id;
            app.refresh();
          }, { primary: app.lobbyMode === m.id }),
        ),
      ),
    ),
    app.lobbyMode === MODE_GAUNTLET
      ? h(
          'label',
          { class: 'field' },
          h('span', {}, `Tower height — ${app.lobbyTowerLength} floors`),
          h('input', {
            type: 'range',
            min: '3',
            max: '30',
            value: String(app.lobbyTowerLength),
            oninput: (e: Event) => {
              app.lobbyTowerLength = Number((e.target as HTMLInputElement).value);
              const label = (e.target as HTMLInputElement).parentElement?.querySelector('span');
              if (label) label.textContent = `Tower height — ${app.lobbyTowerLength} floors`;
            },
          }),
        )
      : null,
  );
}

function onlineScreen(app: App): HTMLElement {
  return h(
    'div',
    { class: 'screen narrow' },
    h('h2', { class: 'title' }, 'Play online'),
    h('p', { class: 'sub' }, 'One of you hosts and reads out the five-letter code. The other types it in. That is the whole matchmaking system.'),
    modeSelector(app),
    h(
      'div',
      { class: 'menu' },
      button(app, 'Host a haul', 'Get a code and send it to your friend', () => app.connect(INTENT_CREATE), {
        primary: true,
        icon: '🪢',
      }),
      button(app, 'Join with a code', 'Your friend already has one open', () => app.show('join'), { icon: '🔑' }),
      button(app, 'Quick match', 'Rope yourself to a stranger', () => app.connect(INTENT_QUICKPLAY), { icon: '🎲' }),
      desktopAvailable()
        ? button(app, 'Host from this machine', 'Runs the server here — for a LAN, or when the public one is down', () => void app.hostLocally(), {
            icon: '🖧',
          })
        : null,
    ),
    app.hostedPort > 0
      ? h(
          'div',
          { class: 'notice', style: { marginTop: '18px' } },
          `This machine is hosting on port ${app.hostedPort}. Your friend joins by setting their server to your address in Settings.`,
        )
      : null,
    h('div', { class: 'row', style: { marginTop: '18px' } }, backButton(app, 'title')),
  );
}

function joinScreen(app: App): HTMLElement {
  const input = h('input', {
    class: 'text code',
    maxlength: '5',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    placeholder: '·····',
    value: app.pendingCode,
    oninput: (e: Event) => {
      const el = e.target as HTMLInputElement;
      el.value = normaliseRoomCode(el.value);
      app.pendingCode = el.value;
      go.disabled = !isValidRoomCode(el.value);
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && isValidRoomCode(app.pendingCode)) submit();
    },
  });

  const submit = (): void => {
    if (!isValidRoomCode(app.pendingCode)) {
      app.sfx.ui('error');
      toast('That code is not quite right');
      return;
    }
    app.connect(INTENT_JOIN, app.pendingCode);
  };

  const go = h(
    'button',
    { class: 'btn primary', disabled: !isValidRoomCode(app.pendingCode), onclick: submit },
    h('span', { class: 'icon' }, '🪢'),
    h('span', {}, h('span', { class: 'label' }, 'Join haul')),
  );

  queueMicrotask(() => input.focus());

  return h(
    'div',
    { class: 'screen narrow' },
    h('h2', { class: 'title' }, 'Join a haul'),
    h('p', { class: 'sub' }, 'Codes never contain letters that sound alike, so reading one out loud actually works.'),
    h('label', { class: 'field' }, h('span', {}, 'Room code'), input),
    h('div', { class: 'menu' }, go),
    h('div', { class: 'row', style: { marginTop: '18px' } }, backButton(app, 'online')),
  );
}

function connectingScreen(app: App): HTMLElement {
  return h(
    'div',
    { class: 'screen narrow' },
    h('h2', { class: 'title' }, 'Connecting'),
    h('p', { class: 'sub' }, app.connectingLabel),
    h('div', { class: 'spinner' }),
    h('div', { class: 'row end' }, backButton(app, 'online', 'Cancel')),
  );
}

/* ------------------------------------------------------------------- lobby */

function playerCard(app: App, index: number): HTMLElement {
  const net = app.net;
  const peer = net?.peers[index];
  const present = peer?.present ?? false;
  const isLocal = net?.localIndex === index;
  // Mirror the in-match rule: two haulers never wear the same colour, so the
  // lobby preview shows exactly who you will be looking at.
  const colour = present ? app.displayColours()[index] : index;
  const hat = present ? peer!.hat : 0;

  return h(
    'div',
    { class: `pcard p${index + 1}${present ? '' : ' empty'}` },
    h('div', { class: 'slot' }, index === 0 ? 'Hauler one' : 'Hauler two'),
    h('div', { class: 'who' }, present ? peer!.name : 'Waiting for a friend…'),
    present ? preview(() => colour, () => hat) : h('div', { class: 'spinner' }),
    present
      ? h('div', { class: `tag ${peer!.ready ? 'ready' : 'waiting'}` }, peer!.ready ? '✓ Ready' : 'Not ready')
      : h('div', { class: 'tag' }, 'Empty'),
    isLocal ? h('div', { class: 'tag', style: { marginLeft: '8px' } }, 'You') : null,
  );
}

function lobbyScreen(app: App): HTMLElement {
  const net = app.net;
  const code = net?.roomCode ?? '';
  const me = net?.localIndex ?? 0;
  const ready = net?.peers[me]?.ready ?? false;
  const bothHere = Boolean(net?.peers[0].present && net?.peers[1].present);

  return h(
    'div',
    { class: 'screen' },
    h('h2', { class: 'title' }, app.lobbyMode === MODE_GAUNTLET ? 'The Gauntlet' : 'The Long Haul'),
    h('p', { class: 'sub' }, 'Both of you press ready. Nobody starts alone.'),
    h(
      'div',
      { class: 'codebox' },
      h('div', {}, h('div', { class: 'what' }, 'Room code'), h('div', { class: 'code' }, code || '·····')),
      h('div', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            void navigator.clipboard?.writeText(code).then(
              () => toast('Code copied'),
              () => toast(`Your code is ${code}`),
            );
            app.sfx.ui('confirm');
          },
        },
        'Copy',
      ),
      steamAvailable()
        ? h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                if (inviteFriend(code)) toast('Steam invite opened');
                app.sfx.ui('confirm');
              },
            },
            'Invite on Steam',
          )
        : null,
    ),
    h('div', { class: 'players' }, playerCard(app, 0), playerCard(app, 1)),
    !bothHere ? h('div', { class: 'notice' }, 'Send your friend the code above. The match starts the moment you are both ready.') : null,
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        {
          class: 'btn ghost',
          onclick: () => {
            app.sfx.ui('back');
            app.leave();
          },
        },
        '← Leave',
      ),
      h('div', { class: 'spacer' }),
      button(app, ready ? 'Not ready' : 'Ready', '', () => app.setReady(!ready), { primary: !ready, icon: ready ? '⏸' : '✓' }),
    ),
  );
}

/* ------------------------------------------------------------------- pause */

function pauseScreen(app: App): HTMLElement {
  const online = app.net !== null;
  return h(
    'div',
    { class: 'screen narrow' },
    h('h2', { class: 'title' }, 'Paused'),
    h('p', { class: 'sub' }, online ? 'The world keeps turning in online play — your hauler is standing very still and looking foolish.' : 'Take your time.'),
    h(
      'div',
      { class: 'menu' },
      button(app, 'Resume', '', () => app.resume(), { primary: true, icon: '▶' }),
      button(app, 'How to play', '', () => app.show('controls'), { icon: '🎮' }),
      button(app, 'Settings', '', () => app.show('settings'), { icon: '⚙️' }),
      button(app, online ? 'Leave the haul' : 'Back to menu', '', () => app.leave(), { icon: '🚪' }),
    ),
  );
}

/* ----------------------------------------------------------------- results */

function resultsScreen(app: App): HTMLElement {
  const r = app.lastResult;
  if (!r) return h('div', { class: 'screen narrow' }, h('h2', { class: 'title' }, 'Run over'), h('div', { class: 'row' }, backButton(app, 'title')));

  const seconds = r.finishTick / 60;
  const totalDeaths = r.deaths[0] + r.deaths[1];
  const verdicts = [
    { when: () => r.cargoBreaks === 0 && totalDeaths === 0, text: 'Flawless. Nobody will believe you.' },
    { when: () => r.cargoBreaks === 0, text: 'The crate survived. You did not, repeatedly.' },
    { when: () => r.betrayals > 20, text: 'You dragged each other off that tower like it was the point.' },
    { when: () => totalDeaths > 40, text: 'A triumph of persistence over talent.' },
    { when: () => r.bonds > r.betrayals * 2, text: 'Genuinely good teamwork. Suspicious.' },
    { when: () => true, text: 'Delivered. Mostly.' },
  ];
  const verdict = verdicts.find((v) => v.when())!.text;

  return h(
    'div',
    { class: 'screen' },
    h('h2', { class: 'title' }, app.finishedRun ? 'Delivered' : 'Run over'),
    h('div', { class: 'verdict' }, verdict),
    h(
      'div',
      { class: 'stats' },
      stat(formatTime(seconds), 'Total time', 'gold'),
      stat(String(totalDeaths), 'Deaths', totalDeaths > 20 ? 'bad' : ''),
      stat(String(r.cargoBreaks), 'Crates destroyed', r.cargoBreaks > 0 ? 'bad' : 'good'),
      stat(String(r.betrayals), 'Times you yanked each other off a ledge', r.betrayals > 10 ? 'bad' : ''),
      stat(String(r.bonds), 'Moments spent braced for your partner', 'good'),
      stat(String(r.checkpoints + 1), 'Checkpoints reached', ''),
    ),
    h(
      'div',
      { class: 'row' },
      backButton(app, 'title', 'Back to menu'),
      h('div', { class: 'spacer' }),
      app.net ? button(app, 'Rematch', 'Same friend, fresh regrets', () => app.rematch(), { primary: true, icon: '🔁' }) : null,
      !app.net ? button(app, 'Play again', '', () => app.restartLocal(), { primary: true, icon: '🔁' }) : null,
    ),
  );
}

function stat(value: string, label: string, tone: string): HTMLElement {
  return h('div', { class: `stat ${tone}` }, h('div', { class: 'n' }, value), h('div', { class: 'l' }, label));
}

/* ---------------------------------------------------------------- settings */

function slider(app: App, name: string, desc: string, get: () => number, set: (v: number) => void): HTMLElement {
  const val = h('span', { class: 'val' }, `${Math.round(get() * 100)}%`);
  return h(
    'div',
    { class: 'checkline' },
    h('div', {}, h('div', { class: 'name' }, name), h('div', { class: 'desc' }, desc)),
    h(
      'div',
      { class: 'ctl' },
      h('input', {
        type: 'range',
        min: '0',
        max: '100',
        value: String(Math.round(get() * 100)),
        oninput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value) / 100;
          set(v);
          val.textContent = `${Math.round(v * 100)}%`;
          app.applySettings();
        },
      }),
      val,
    ),
  );
}

function toggle(app: App, name: string, desc: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  return h(
    'div',
    { class: 'checkline' },
    h('div', {}, h('div', { class: 'name' }, name), h('div', { class: 'desc' }, desc)),
    h(
      'div',
      { class: 'ctl' },
      h('input', {
        type: 'checkbox',
        checked: get(),
        onchange: (e: Event) => {
          set((e.target as HTMLInputElement).checked);
          app.applySettings();
        },
      }),
    ),
  );
}

function settingsScreen(app: App): HTMLElement {
  const s = app.settings;
  return h(
    'div',
    { class: 'screen' },
    h('h2', { class: 'title' }, 'Settings'),
    h(
      'div',
      { class: 'scroll' },
      slider(app, 'Master volume', 'Everything at once', () => s.master, (v) => (s.master = v)),
      slider(app, 'Sound effects', 'Thuds, twangs and disappointment', () => s.sfx, (v) => (s.sfx = v)),
      slider(app, 'Music', 'Generated live, never the same twice', () => s.music, (v) => (s.music = v)),
      slider(app, 'Screen shake', 'Set to zero if it makes you queasy', () => s.shake, (v) => (s.shake = v)),
      toggle(app, 'High contrast', 'Flat, maximally readable colours', () => s.highContrast, (v) => (s.highContrast = v)),
      toggle(app, 'Reduce flashing', 'Removes full-screen flashes on impacts', () => s.reducedFlash, (v) => (s.reducedFlash = v)),
      toggle(app, 'Motion trails', 'Afterimages when you are moving very fast', () => s.showGhostTrail, (v) => (s.showGhostTrail = v)),
      toggle(app, 'Show connection stats', 'Ping, rollbacks and resyncs on the HUD', () => s.showNetgraph, (v) => (s.showNetgraph = v)),
      h(
        'label',
        { class: 'field', style: { marginTop: '20px' } },
        h('span', {}, 'Server'),
        h('input', {
          class: 'text',
          value: s.serverUrl,
          spellcheck: 'false',
          onchange: (e: Event) => {
            s.serverUrl = (e.target as HTMLInputElement).value.trim();
            app.applySettings();
            toast('Server updated');
          },
        }),
      ),
      h('p', { class: 'sub' }, 'Leave this alone unless you are running your own server. Both players must be on the same one.'),
      h(
        'div',
        { class: 'row' },
        button(app, 'Rebind controls', '', () => app.show('controls'), { icon: '⌨️' }),
        button(app, 'Reset to defaults', '', () => {
          app.resetSettings();
          toast('Settings reset');
        }, { icon: '↺' }),
      ),
    ),
    h('div', { class: 'row', style: { marginTop: '18px' } }, backButton(app, 'auto')),
  );
}

/* ---------------------------------------------------------------- controls */

function controlsScreen(app: App): HTMLElement {
  const slot = app.rebindSlot;
  const bindings = slot === 0 ? app.input.config.p1 : app.input.config.p2;

  const row = (action: Action): HTMLElement =>
    h(
      'div',
      { class: 'checkline' },
      h('div', {}, h('div', { class: 'name' }, ACTION_LABEL[action])),
      h(
        'div',
        { class: 'ctl' },
        h(
          'button',
          {
            class: 'btn',
            style: { padding: '8px 14px' },
            onclick: (e: Event) => {
              const target = e.currentTarget as HTMLButtonElement;
              target.textContent = 'Press a key…';
              app.input.capture = (code) => {
                app.input.rebind(slot, action, code);
                app.refresh();
              };
            },
          },
          bindings[action].map(keyName).join(' / ') || 'Unbound',
        ),
      ),
    );

  return h(
    'div',
    { class: 'screen' },
    h('h2', { class: 'title' }, 'How to play'),
    h('p', { class: 'sub' }, 'You are tied to your friend by a rope that will not stretch past a point. Everything interesting comes from that.'),
    h(
      'div',
      { class: 'controls-grid' },
      verb('Move & jump', ['A', 'D', 'SPACE'], 'Standard platforming. Coyote time and jump buffering are generous, because the rope is not.'),
      verb('Grip', ['L-SHIFT'], 'Hold to lock yourself in place on the ground or a wall. You become an anchor: your partner can now swing, be reeled in, or be flung. Grip drains except on yellow rebar.'),
      verb('Reel', ['F'], 'Drag yourself along the rope toward your partner. The fastest way up is usually someone else.'),
      verb('Emote', ['T'], 'Apologise. Or do not.'),
      verb('Restart', ['R'], 'Both of you must hold it to reset to the last checkpoint.'),
      verb('Pause', ['ESC'], 'Online play keeps running while you are in the menu.'),
    ),
    h('div', { class: 'notice', style: { marginTop: '18px' } }, 'Gamepads work out of the box: stick to move, A to jump, right trigger to grip, left trigger to reel.'),
    h('h2', { class: 'title', style: { marginTop: '20px', fontSize: '22px' } }, 'Key bindings'),
    h(
      'div',
      { class: 'row', style: { marginBottom: '10px' } },
      button(app, 'Player one', '', () => {
        app.rebindSlot = 0;
        app.refresh();
      }, { primary: slot === 0 }),
      button(app, 'Player two (couch co-op)', '', () => {
        app.rebindSlot = 1;
        app.refresh();
      }, { primary: slot === 1 }),
    ),
    h('div', { class: 'scroll' }, ...ACTIONS.map(row)),
    h(
      'div',
      { class: 'row', style: { marginTop: '18px' } },
      backButton(app, 'auto'),
      h('div', { class: 'spacer' }),
      button(app, 'Reset bindings', '', () => {
        app.input.resetDefaults();
        app.refresh();
        toast('Bindings reset');
      }),
    ),
  );
}

function verb(name: string, keys: string[], desc: string): HTMLElement {
  return h(
    'div',
    { class: 'ctrl' },
    h('div', { class: 'keys' }, ...keys.map((k) => h('kbd', {}, k))),
    h('div', { class: 'name' }, name),
    h('div', { class: 'desc' }, desc),
  );
}

/* --------------------------------------------------------------- customise */

function customiseScreen(app: App): HTMLElement {
  const s = app.settings;
  const unlocked = new Set(app.profile.unlockedHats);

  return h(
    'div',
    { class: 'screen' },
    h('h2', { class: 'title' }, 'Customise'),
    h('p', { class: 'sub' }, 'Purely cosmetic. Entirely essential.'),
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'Name'),
      h('input', {
        class: 'text',
        maxlength: '18',
        value: s.playerName,
        placeholder: 'HAULER',
        oninput: (e: Event) => {
          s.playerName = (e.target as HTMLInputElement).value;
          app.applySettings();
        },
      }),
    ),
    h(
      'div',
      { style: { textAlign: 'center', margin: '10px 0 18px' } },
      preview(() => s.colour, () => s.hat),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'Colour'),
      h(
        'div',
        { class: 'swatches' },
        ...PLAYER_COLOURS.map((c, i) =>
          h('button', {
            class: 'swatch',
            title: c.name,
            'aria-pressed': String(s.colour === i),
            style: { background: c.main },
            onclick: () => {
              s.colour = i;
              app.applySettings();
              app.refresh();
            },
          }),
        ),
      ),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'Hat'),
      h(
        'div',
        { class: 'menu two' },
        ...HATS.map((hat) => {
          const has = unlocked.has(hat.id);
          return button(
            app,
            has ? hat.name : '🔒 Locked',
            has ? '' : hat.unlock,
            () => {
              s.hat = hat.id;
              app.applySettings();
              app.refresh();
            },
            { primary: s.hat === hat.id, disabled: !has },
          );
        }),
      ),
    ),
    h('div', { class: 'row', style: { marginTop: '10px' } }, backButton(app, 'title')),
  );
}

/* ------------------------------------------------------------------- couch */

function couchScreen(app: App): HTMLElement {
  const pads = app.input.padCount;
  return h(
    'div',
    { class: 'screen narrow' },
    h('h2', { class: 'title' }, 'Couch co-op'),
    h(
      'p',
      { class: 'sub' },
      pads >= 2
        ? 'Two gamepads detected. Perfect.'
        : pads === 1
          ? 'One gamepad detected — player two can use the arrow keys, right shift and right control.'
          : 'No gamepads detected. Player one uses WASD, player two uses the arrow keys, right shift and right control.',
    ),
    modeSelector(app),
    h(
      'div',
      { class: 'menu' },
      button(app, 'Start', 'Both haulers on one screen', () => app.startCouch(), { primary: true, icon: '▶' }),
      button(app, 'Rebind keys', '', () => app.show('controls'), { icon: '⌨️' }),
    ),
    h('div', { class: 'row', style: { marginTop: '18px' } }, backButton(app, 'title')),
  );
}

/* ------------------------------------------------------------ achievements */

function achievementsScreen(app: App): HTMLElement {
  const earned = new Set(app.achievements.earned);
  return h(
    'div',
    { class: 'screen' },
    h('h2', { class: 'title' }, 'Achievements'),
    h('p', { class: 'sub' }, `${earned.size} of ${ACHIEVEMENTS.length} earned.`),
    h(
      'div',
      { class: 'scroll' },
      ...ACHIEVEMENTS.map((a) =>
        h(
          'div',
          { class: 'checkline' },
          h(
            'div',
            {},
            h('div', { class: 'name' }, earned.has(a.id) ? `🏆 ${a.name}` : `🔒 ${a.name}`),
            h('div', { class: 'desc' }, a.description),
          ),
          h('div', { class: 'ctl' }, h('div', { class: `tag ${earned.has(a.id) ? 'ready' : ''}` }, earned.has(a.id) ? 'Earned' : 'Locked')),
        ),
      ),
    ),
    h('div', { class: 'row', style: { marginTop: '18px' } }, backButton(app, 'title')),
  );
}

/* ------------------------------------------------------------------- error */

function errorScreen(app: App): HTMLElement {
  return h(
    'div',
    { class: 'screen narrow' },
    h('h2', { class: 'title' }, 'Disconnected'),
    h('div', { class: 'notice bad' }, app.errorMessage || 'Something went wrong.'),
    h(
      'div',
      { class: 'menu' },
      button(app, 'Back to menu', '', () => app.show('title'), { primary: true }),
      button(app, 'Check the server setting', '', () => app.show('settings')),
      desktopAvailable()
        ? button(app, 'Host from this machine instead', 'Runs a server here and opens a haul on it', () => void app.hostLocally(), {
            icon: '🖧',
          })
        : null,
    ),
    h(
      'p',
      { class: 'sub', style: { marginTop: '18px' } },
      'Running your own server? ',
      h(
        'a',
        {
          href: '#',
          style: { color: '#ffb03a' },
          onclick: (e: Event) => {
            e.preventDefault();
            openExternal('https://github.com/masonobegi/lego_identifier#running-a-server');
          },
        },
        'Read the setup guide',
      ),
      '.',
    ),
  );
}

export { DEFAULT_TOWER_LENGTH };
