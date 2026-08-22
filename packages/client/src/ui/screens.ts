import {
  DEFAULT_TOWER_LENGTH,
  INTENT_CREATE,
  INTENT_JOIN,
  INTENT_QUICKPLAY,
  MODE_GAUNTLET,
  MODE_HAUL,
  dailyLabel,
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
import { DEFAULT_SERVER, offlineBuild } from '../settings.js';
import { formatTime } from '../render/hud.js';
import type { App } from '../app.js';
import type { MatchResult } from '@haulmates/core';

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
  | 'records'
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
    case 'records':
      return recordsScreen(app);
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
    h('h1', { class: 'logo' }, 'HAULMATES'),
    h('p', { class: 'tagline' }, 'A two-player co-op disaster'),
    h(
      'div',
      { class: 'menu' },
      // A caption on every item is what makes a menu read as written by a
      // machine: six buttons in a column, each with a title and a small joke
      // underneath it. Real menus are terse. These say something only where
      // there is something a player cannot work out from the label — whether
      // online play is available in this build, and how many achievements are
      // left — and are silent otherwise.
      button(
        app,
        'Play online',
        offlineBuild() ? 'Needs a matchmaking server' : '',
        () => app.show('online'),
        { primary: !offlineBuild(), disabled: offlineBuild() },
      ),
      button(app, 'Play on this machine', '', () => app.show('couch'), { primary: offlineBuild() }),
      button(app, "Today's haul", dailyBlurb(app), () => app.startDaily()),
      button(app, 'How to play', '', () => app.show('controls')),
      button(app, 'Customise', '', () => app.show('customise')),
      button(app, 'Achievements', `${app.achievements.earned.length} / ${ACHIEVEMENTS.length}`, () => app.show('achievements')),
      button(app, 'The ledger', '', () => app.show('records')),
      button(app, 'Settings', '', () => app.show('settings')),
      desktopAvailable() ? button(app, 'Quit', '', () => quitGame()) : null,
    ),
    h(
      'p',
      { class: 'stamp' },
      `v${app.version}${steamAvailable() ? ' · STEAM' : ''}`,
    ),
  );
}

/**
 * What the daily button says underneath itself.
 *
 * Deliberately the one caption on the title screen with a number in it. The
 * rest of that menu is terse on purpose; this one earns its line because it is
 * the only item whose state changes between visits, and the state is the whole
 * reason to press it.
 */
function dailyBlurb(app: App): string {
  const d = app.profile.daily;
  if (d.day !== app.today) return `${dailyLabel(app.today)} — not attempted`;
  const streak = d.streak > 1 ? ` · ${d.streak} days running` : '';
  if (d.bestTicks > 0) return `Delivered in ${formatTime(d.bestTicks / 60)}${streak}`;
  return `${d.bestCheckpoints} checkpoints in ${d.attempts} ${d.attempts === 1 ? 'try' : 'tries'}${streak}`;
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
      }),
      // The daily is the one tower in the game two people can be certain they
      // are both looking at, which is the only reason anybody compares a run.
      // Leaving it playable alone only made it a score nobody could contest.
      button(app, "Host today's haul", `${dailyLabel(app.today)} — the tower everybody has today`, () => app.hostDaily()),
      button(app, 'Join with a code', 'Your friend already has one open', () => app.show('join'), ),
      button(app, 'Quick match', 'Rope yourself to a stranger', () => app.connect(INTENT_QUICKPLAY), ),
      desktopAvailable()
        ? button(app, 'Host from this machine', 'Runs the server here — for a LAN, or when the public one is down', () => void app.hostLocally(), )
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
  // Quick match on an empty server opens a public room and waits, which looks
  // exactly like hosting one on purpose. On a game with nobody playing it yet
  // that is the most likely first session there is, and a player who asked to
  // be matched should be told that nobody came rather than left to work it out.
  const waited = app.clockSeconds - app.lobbySince;
  const stranded = !bothHere && app.lobbyIntent === INTENT_QUICKPLAY && waited > 20;

  return h(
    'div',
    { class: 'screen' },
    h('h2', { class: 'title' }, app.dailyRun ? "Today's haul" : app.lobbyMode === MODE_GAUNTLET ? 'The Gauntlet' : 'The Long Haul'),
    // Whoever joined by code did not choose any of this, so the room has to
    // say what it is — a daily is only worth playing if both of you know it is
    // the daily.
    h(
      'p',
      { class: 'sub' },
      app.dailyRun
        ? `${dailyLabel(app.today)}. The same tower as everybody else, until midnight.`
        : 'Both of you press ready. Nobody starts alone.',
    ),
    stranded
      ? h(
          'div',
          { class: 'notice' },
          h('p', {}, 'Nobody else is looking for a haul right now. The code above still works if you want to send it to somebody.'),
          button(app, 'Climb it with the Autohauler', 'Start now, on your own', () => app.giveUpWaiting(), { primary: true }),
        )
      : null,
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
                void inviteFriend(code).then((opened) =>
                  toast(opened ? 'Steam invite opened' : 'Steam would not open the invite'),
                );
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
      button(app, ready ? 'Not ready' : 'Ready', '', () => app.setReady(!ready), { primary: !ready }),
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
      button(app, 'Resume', '', () => app.resume(), { primary: true }),
      // Only offline. One peer cannot wind the shared world back on its own,
      // and the pair have the held vote for it.
      !online
        ? button(app, 'Restart at checkpoint', 'Where you got stuck stays stuck otherwise', () => app.restartAtCheckpoint())
        : null,
      button(app, 'How to play', '', () => app.show('controls'), ),
      button(app, 'Settings', '', () => app.show('settings'), ),
      button(app, online ? 'Leave the haul' : 'Back to menu', '', () => app.leave(), ),
    ),
  );
}

/* ----------------------------------------------------------------- results */

function resultsScreen(app: App): HTMLElement {
  const r = app.lastResult;
  if (!r) {
    return h(
      'div',
      { class: 'screen narrow' },
      h('h2', { class: 'title' }, 'Run over'),
      h('div', { class: 'row' }, button(app, '← Back to menu', '', () => app.leave(), )),
    );
  }

  const seconds = r.finishTick / 60;
  const totalDeaths = r.deaths[0] + r.deaths[1];
  // Every one of these used to be a statement about the stat sheet and none of
  // them was a statement about the run. Quit twelve seconds in, having climbed
  // nothing, and the card read "Flawless. Nobody will believe you." — which was
  // true of the numbers and a lie about the evening. So the flattering ones now
  // have to get past `app.finishedRun`, and a run that ended early gets told
  // what actually happened to it.
  const done = app.finishedRun;
  // Ordered most specific first, and the two catch-alls are last on purpose.
  //
  // `{ when: () => done }` used to sit sixth of twelve, which made it a catch-all
  // in the middle of the ladder: every line below it was unreachable by anyone
  // who finished a run, so the six sharpest observations in the game — the
  // twenty betrayals, the four dead crates, the near miss at the top — could
  // only ever be read by somebody who had given up. The screen that is supposed
  // to be the reward for finishing told the people who finished the blandest
  // line it has.
  const verdicts = [
    { when: () => done && r.cargoBreaks === 0 && totalDeaths === 0, text: 'Flawless. Nobody will believe you.' },
    { when: () => done && r.boosts === 0, text: 'And neither of you ever once gave the other a leg up. Extraordinary.' },
    { when: () => r.cargoBreaks > 3, text: `${r.cargoBreaks} crates. The client has been informed.` },
    { when: () => r.betrayals > 20, text: 'You dragged each other off that tower like it was the point.' },
    { when: () => totalDeaths > 40, text: done ? 'A triumph of persistence over talent.' : 'The tower is still there. So, remarkably, are you.' },
    { when: () => done && r.bonds > r.betrayals * 2, text: 'Genuinely good teamwork. Suspicious.' },
    { when: () => done && r.cargoBreaks === 0, text: 'The crate survived. You did not, repeatedly.' },
    { when: () => !done && r.checkpoints === 0, text: 'You did not leave the yard.' },
    { when: () => !done && r.checkpoints >= 16, text: 'So close you could read the sign.' },
    { when: () => done, text: 'Mostly in one piece, which is the job.' },
    { when: () => true, text: `${r.checkpoints} checkpoints. The crate is somebody else's problem now.` },
  ];
  const verdict = verdicts.find((v) => v.when())!.text;

  // The line that makes you press Play again.
  const best = app.targetTicks;
  let against: string | null = null;
  if (done && best > 0) {
    const delta = (r.finishTick - best) / 60;
    against =
      delta < 0
        ? `${formatTime(-delta)} faster than your best. That is the new one.`
        : delta < 30
          ? `${formatTime(delta)} off your best of ${formatTime(best / 60)}. Go again.`
          : `Your best is still ${formatTime(best / 60)}.`;
  } else if (done) {
    against = 'First one home. Everything from here is a personal best to beat.';
  }

  return h(
    'div',
    { class: 'screen' },
    h('h2', { class: 'title' }, app.finishedRun ? 'Delivered' : 'Run over'),
    h('div', { class: 'verdict' }, verdict),
    against ? h('p', { class: 'sub' }, against) : null,
    crewLine(app),
    h(
      'div',
      { class: 'stats' },
      stat(formatTime(seconds), 'Total time', 'gold'),
      stat(String(totalDeaths), 'Deaths', totalDeaths > 20 ? 'bad' : ''),
      stat(String(r.cargoBreaks), plural(r.cargoBreaks, 'Crate', 'Crates') + ' destroyed', r.cargoBreaks > 0 ? 'bad' : 'good'),
      stat(String(r.betrayals), plural(r.betrayals, 'Time', 'Times') + ' you yanked each other off a ledge', r.betrayals > 10 ? 'bad' : ''),
      stat(String(r.boosts), plural(r.boosts, 'Time', 'Times') + ' one of you stood on the other', 'good'),
      stat(String(r.bonds), 'Moments spent braced for your partner', 'good'),
      stat(String(r.checkpoints), plural(r.checkpoints, 'Checkpoint', 'Checkpoints') + ' reached', ''),
    ),
    h(
      'div',
      { class: 'row' },
      // Must end the session, not just change screens: a finished LocalMatch
      // left alive drags the player straight back here.
      button(app, '← Back to menu', '', () => app.leave(), { key: 'ESC' }),
      app.dailyRun ? button(app, 'Copy the docket', '', () => copyDocket(app, r), ) : null,
      h('div', { class: 'spacer' }),
      app.net ? button(app, 'Rematch', rematchHint(app), () => app.rematch(), { primary: true }) : null,
      !app.net ? replayButton(app) : null,
    ),
  );
}

/**
 * What pressing the big button again actually gets you.
 *
 * "Play again" meant one thing on every mode and was a lie on two of them: the
 * Gauntlet's whole content is that the tower is different every time, and the
 * daily's whole content is that it is not. A label that does not say which of
 * those is about to happen leaves the player to find out by climbing it.
 */
function replayButton(app: App): HTMLElement {
  if (app.dailyRun) {
    return button(app, 'Go again', 'Today’s tower, until midnight', () => app.restartLocal(), { primary: true });
  }
  if (app.local?.ctx.mode === MODE_GAUNTLET) {
    return button(app, 'A new tower', 'Another Gauntlet, assembled from scratch', () => app.restartLocal(), { primary: true });
  }
  return button(app, 'Climb it again', 'From the yard, with the crate intact', () => app.restartLocal(), { primary: true });
}

/** A rematch keeps the room, so it keeps whatever tower the room is on. */
function rematchHint(app: App): string {
  if (app.dailyRun) return 'Today’s tower again, same friend';
  return app.lobbyMode === MODE_GAUNTLET ? 'Same friend, a tower neither of you has seen' : 'Same friend, fresh regrets';
}

/**
 * The daily run as a line you can paste to the person you played it with.
 *
 * The daily's whole reason to exist is that your friend is climbing the same
 * tower today, and a score nobody else can see is not a thing anybody compares.
 * Written as a delivery docket rather than a scoreboard, because that is the
 * voice the rest of the game is in, and deliberately without a grid of emoji —
 * the shape everybody copies, and the one that would make this read as the
 * thing it is imitating rather than as this game.
 */
function copyDocket(app: App, r: MatchResult): void {
  const deaths = r.deaths[0] + r.deaths[1];
  const lines = [
    `HAULMATES — ${dailyLabel(app.today)}`,
    app.finishedRun
      ? `DELIVERED in ${formatTime(r.finishTick / 60)}`
      : `GAVE UP at checkpoint ${r.checkpoints}`,
    `${r.cargoBreaks} crates lost · ${deaths} deaths · ${r.boosts} lifts · ${r.betrayals} betrayals`,
  ];
  const text = lines.join('\n');
  const done = (): void => toast('Docket copied. Go and gloat.');
  try {
    void navigator.clipboard.writeText(text).then(done, () => toast(text));
  } catch {
    // No clipboard (an insecure origin, an old browser, a locked-down desktop
    // build): show it instead, so the feature degrades to something you can
    // still read off the screen and retype rather than to nothing at all.
    toast(text);
  }
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
      toggle(app, 'Reduce flashing', 'Removes impact flashes and holds blinking warnings steady', () => s.reducedFlash, (v) => (s.reducedFlash = v)),
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
            // Typing an address here means "use this one", and it has to
            // survive the next release changing the built-in default.
            s.serverPinned = s.serverUrl.length > 0;
            app.applySettings();
            toast('Server updated');
          },
        }),
      ),
      h(
        'p',
        { class: 'sub' },
        s.serverPinned
          ? 'Using your own server. Both players must be on the same one.'
          : 'Following the address this build ships with. Both players must be on the same one.',
      ),
      s.serverPinned
        ? h(
            'div',
            { class: 'row' },
            button(app, 'Use the built-in server', '', () => {
              s.serverPinned = false;
              s.serverUrl = DEFAULT_SERVER;
              app.applySettings();
              app.refresh();
              toast('Back to the built-in server');
            }, ),
          )
        : null,
      h(
        'div',
        { class: 'row' },
        button(app, 'Rebind controls', '', () => app.show('controls'), ),
        button(app, 'Reset to defaults', '', () => {
          app.resetSettings();
          toast('Settings reset');
        }, ),
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
                const clash = app.input.boundToOtherPlayer(slot, code);
                if (clash) {
                  toast(`${keyName(code)} is player ${slot === 0 ? 'two' : 'one'}'s ${ACTION_LABEL[clash].toLowerCase()}`);
                } else {
                  app.input.rebind(slot, action, code);
                }
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
      // Listed above the jokes and below the two keys it is made of, because
      // it is not a key: it is the one move in the tower that has no button,
      // and the one without which the tower does not go anywhere. A player who
      // reads this screen and leaves still not knowing it exists will spend
      // four minutes at the first gate deciding the game is broken.
      verb('Leg up', ['SHIFT', '+', 'SPACE'], 'The only way past a two-person lift. One of you braces on the ground; the other stands against them and jumps, and goes half again as high. It costs the brace a chunk of grip, so it is not free and it is not spammable.'),
      // Under the leg up because it is the other half of the same lesson, and
      // with no key on it because it does not have one: the whole of the hold
      // is standing somewhere, which is exactly why a pair can walk into a room
      // with a shut door in it and never once suspect the panel in the floor.
      verb(
        'The hold',
        ['NO KEY'],
        'A floor plate holds its shutter open only while something is standing on it, and a shutter always has a plate on each side. You hold, they cross, they hold, you cross. The crate can hold one down, but it hangs off the middle of the rope and follows you both.',
      ),
      verb('Emote', ['T'], 'Apologise. Or do not.'),
      verb('Restart', ['R'], 'Hold to go back to the last checkpoint. With a friend on the other end of the rope, both of you have to hold it; the Autohauler holds it with you.'),
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
            has ? hat.name : 'Locked',
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
  const partner = (label: string, hint: string, bot: boolean): HTMLElement =>
    button(app, label, hint, () => {
      app.botPartner = bot;
      app.refresh();
    }, { primary: app.botPartner === bot });

  return h(
    'div',
    { class: 'screen narrow' },
    h('h2', { class: 'title' }, 'Play on this machine'),
    h(
      'p',
      { class: 'sub' },
      app.botPartner
        ? 'The Autohauler knows the route, waits when the rope goes tight, and braces so you can climb off it. It will not save you from yourself.'
        : pads >= 2
          ? 'Two gamepads detected. Perfect.'
          : pads === 1
            ? 'One gamepad detected — player two can use the arrow keys, right shift and right control.'
            : 'Player one uses WASD, player two uses the arrow keys, right shift and right control.',
    ),
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'Second hauler'),
      h(
        'div',
        { class: 'menu two' },
        partner('A friend', 'One keyboard, or two pads', false),
        partner('A bot', 'The Autohauler', true),
      ),
    ),
    modeSelector(app),
    h(
      'div',
      { class: 'menu' },
      button(app, 'Start', app.botPartner ? 'You and the Autohauler' : 'Both haulers on one screen', () => app.startCouch(), {
        primary: true,
      }),
      button(app, "Today's haul", dailyBlurb(app), () => app.startDaily()),
      button(app, 'Rebind keys', '', () => app.show('controls'), ),
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
            // No padlock and no trophy. The pill on the right of the row
            // already says which it is, so the emoji was saying it twice — and
            // a stock glyph is the one thing on screen not drawn in the
            // game's own hand, on a screen made entirely of hazard tape and
            // stencils.
            h('div', { class: 'name' }, a.name),
            h('div', { class: 'desc' }, a.description),
          ),
          h('div', { class: 'ctl' }, h('div', { class: `tag ${earned.has(a.id) ? 'ready' : ''}` }, earned.has(a.id) ? 'Earned' : 'Locked')),
        ),
      ),
    ),
    h('div', { class: 'row', style: { marginTop: '18px' } }, backButton(app, 'title')),
  );
}

/**
 * What you and this particular person have done together, so far.
 *
 * Every other number the game keeps is about one player, and none of them is a
 * reason to open it again on night four with the same friend — which for a
 * two-player game with no matchmaking population is the only night that
 * decides whether it was worth buying. This is the smallest thing that makes
 * the fourth evening different from the first: a tally the two of you own,
 * that only moves when both of you are here.
 */
function crewLine(app: App): HTMLElement | null {
  const mate = app.net?.peers[1 - app.net.localIndex]?.name;
  if (!mate) return null;
  const crew = app.profile.crews.find((c) => c.name === mate.trim().toUpperCase());
  if (!crew || crew.runs < 2) return null;
  const bits = [`${crew.runs} hauls with ${crew.name}`];
  if (crew.finishes > 0) bits.push(`${crew.finishes} delivered`);
  if (crew.bestTicks > 0) bits.push(`best together ${formatTime(crew.bestTicks / 60)}`);
  if (crew.bestFloors > 0) bits.push(`tallest ${crew.bestFloors} floors`);
  if (crew.boosts > 0) bits.push(`${crew.boosts} legs up`);
  return h('p', { class: 'sub crew' }, bits.join(' · '));
}

/** "1 TIMES ONE OF YOU STOOD ON THE OTHER" was on the funniest screen in the game. */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/* ----------------------------------------------------------------- records */

/** One block of the docket: a heading and its ruled lines. */
function ledger(heading: string, rows: [what: string, value: string, tone?: string][]): HTMLElement {
  return h(
    'div',
    { class: 'ledger' },
    h('div', { class: 'head' }, heading),
    ...rows.map(([what, value, tone]) =>
      h('div', { class: `line ${tone ?? ''}` }, h('span', { class: 'what' }, what), h('span', { class: 'n' }, value)),
    ),
  );
}

/**
 * Everything you have carried up that tower, and everything you dropped.
 *
 * Eleven lifetime counters were being written to disk from the first run and
 * not one of them was ever shown to anybody — including two personal bests the
 * results card races you against. Coming back on day three is the whole reason
 * a game like this has a profile at all, and the numbers that would earn it
 * were sitting in local storage.
 *
 * Laid out as a delivery docket rather than a stat sheet because that is the
 * voice the rest of the game speaks in, and because a docket has an opinion
 * about its own columns: what arrived, what it cost, what the pair of you did
 * for each other on the way.
 */
/** The people you have hauled with, most recent first. */
function crewLedger(app: App): HTMLElement | null {
  const crews = [...app.profile.crews].sort((a, b) => b.lastDay - a.lastDay || b.runs - a.runs);
  if (crews.length === 0) return null;
  return ledger(
    'Crews',
    crews.map((c) => [
      c.name,
      [
        `${c.runs} haul${c.runs === 1 ? '' : 's'}`,
        c.finishes > 0 ? `${c.finishes} delivered` : null,
        c.bestTicks > 0 ? formatTime(c.bestTicks / 60) : null,
        c.bestFloors > 0 ? `${c.bestFloors} floors` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      c.finishes > 0 ? 'good' : '',
    ]) as [string, string, string?][],
  );
}

function recordsScreen(app: App): HTMLElement {
  const p = app.profile;
  const d = p.daily;
  const lost = Math.max(0, p.runs - p.finishes);
  // A streak is only alive if it was fed today or yesterday; anything older is
  // a streak that has already been broken and is waiting to be told.
  const streak = d.day === app.today || d.day === app.today - 1 ? d.streak : 0;
  const today =
    d.day !== app.today
      ? 'Not attempted'
      : d.bestTicks > 0
        ? formatTime(d.bestTicks / 60)
        : `${d.bestCheckpoints} checkpoints in ${d.attempts} ${d.attempts === 1 ? 'try' : 'tries'}`;

  const notes = [
    { when: () => p.runs === 0, text: 'Nothing on the books yet. The first crate is the hard one.' },
    { when: () => p.finishes === 0, text: 'Nothing delivered yet. The tower is not going anywhere.' },
    { when: () => p.cargoBreaks > p.finishes, text: 'More crates lost than delivered. The client has stopped ringing.' },
    { when: () => p.betrayals > p.bonds, text: 'More ledges yanked out from under each other than moments spent holding still for one another. The rope is not the problem.' },
    { when: () => p.boosts === 0, text: 'Not once has either of you stood on the other. There is a whole move down there going unused.' },
    { when: () => true, text: 'Signed off. Next crate.' },
  ];

  return h(
    'div',
    { class: 'screen' },
    h('h2', { class: 'title' }, 'The ledger'),
    h('p', { class: 'sub' }, notes.find((n) => n.when())!.text),
    h(
      'div',
      { class: 'scroll' },
      ledger('Deliveries', [
        ['Jobs taken', String(p.runs)],
        ['Crates delivered', String(p.finishes), p.finishes > 0 ? 'good' : ''],
        ['Abandoned on the way up', String(lost), lost > 0 ? 'bad' : ''],
        ['Height climbed, all told', `${Math.round(p.metres)} m`],
      ]),
      ledger('Best on record', [
        ['Fastest Long Haul', p.bestCampaignTicks > 0 ? formatTime(p.bestCampaignTicks / 60) : 'Not yet delivered', 'gold'],
        ['Tallest Gauntlet finished', p.bestGauntletHeight > 0 ? `${p.bestGauntletHeight} floors` : 'Not yet delivered', 'gold'],
        [dailyLabel(app.today), today],
        ['Days running', streak > 0 ? `${streak}` : '—'],
      ]),
      ledger('Damages', [
        ['Falls', String(p.deaths)],
        ['Crates destroyed', String(p.cargoBreaks), p.cargoBreaks > 0 ? 'bad' : ''],
        ['Times you pulled your partner off a ledge', String(p.betrayals), p.betrayals > 0 ? 'bad' : ''],
      ]),
      ledger('Goodwill', [
        ['Times one of you stood on the other', String(p.boosts), 'good'],
        ['Moments spent braced for your partner', String(p.bonds), 'good'],
      ]),
      crewLedger(app),
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
        ? button(app, 'Host from this machine instead', 'Runs a server here and opens a haul on it', () => void app.hostLocally(), )
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
