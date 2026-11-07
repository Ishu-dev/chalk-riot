import { HEROES, type HeroId } from './config';

/** DOM overlay: scoreline, timer, your stats, and the title and result screens. */
export class Hud {
  private root = document.getElementById('hud')!;
  private mint!: HTMLElement;
  private coral!: HTMLElement;
  private time!: HTMLElement;
  private msg!: HTMLElement;
  private name!: HTMLElement;
  private hp!: HTMLElement;
  private chalk!: HTMLElement;
  private ammo!: HTMLElement;
  private overlay!: HTMLElement;

  constructor() {
    this.root.innerHTML = `
      <div class="top"><span class="pips mint"></span><span class="time">0:00</span><span class="pips coral"></span></div>
      <div class="msg"></div>
      <div class="panel">
        <div class="name"></div>
        hp<div class="bar"><div class="fill hp"></div></div>
        chalk<div class="bar"><div class="fill chalk"></div></div>
        <div class="ammo"></div>
      </div>
      <div class="help">WASD move &middot; mouse aim &middot; left click shoot<br>hold right click or Shift and move the mouse to draw cover<br>M mute sound and music</div>
      <div class="overlay hidden"></div>`;
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.mint = q('.mint');
    this.coral = q('.coral');
    this.time = q('.time');
    this.msg = q('.msg');
    this.name = q('.name');
    this.hp = q('.fill.hp');
    this.chalk = q('.fill.chalk');
    this.ammo = q('.ammo');
    this.overlay = q('.overlay');
  }

  update(o: { mint: number; coral: number; seconds: number; hpFrac: number; chalkFrac: number; ammo: number; ammoMax: number; hero: HeroId; msg: string }): void {
    const pips = (n: number) => [0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    if (this.mint.dataset.n !== String(o.mint)) {
      this.mint.innerHTML = pips(o.mint);
      this.mint.dataset.n = String(o.mint);
    }
    if (this.coral.dataset.n !== String(o.coral)) {
      this.coral.innerHTML = pips(o.coral);
      this.coral.dataset.n = String(o.coral);
    }
    const s = Math.floor(o.seconds);
    this.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.name.textContent = HEROES[o.hero].name;
    this.hp.style.width = `${Math.max(0, o.hpFrac) * 100}%`;
    this.chalk.style.width = `${o.chalkFrac * 100}%`;
    const ammo = Array.from({ length: o.ammoMax }, (_, i) => `<span class="${i < o.ammo ? 'on' : ''}"></span>`).join('');
    if (this.ammo.innerHTML !== ammo) this.ammo.innerHTML = ammo;
    if (this.msg.textContent !== o.msg) this.msg.textContent = o.msg;
  }

  /** Title screen with hero choice. Calls back with the picked hero. */
  title(onStart: (h: HeroId) => void): void {
    const ids = Object.keys(HEROES) as HeroId[];
    this.overlay.innerHTML = `
      <h1>CHALK RIOT</h1>
      <p>3 v 3 on wet asphalt. The rain is washing the court away.</p>
      <div class="heroes">${ids
        .map((id, i) => `<div class="hero" data-id="${id}"><b>${i + 1}. ${HEROES[id].name}</b><small>${HEROES[id].blurb}</small></div>`)
        .join('')}</div>
      <p>${document.body.classList.contains('touch') ? 'tap a hero' : 'click a hero or press 1, 2, 3'}</p>`;
    this.overlay.classList.remove('hidden');
    const go = (id: HeroId) => {
      window.removeEventListener('keydown', onKey);
      // On phones, go full screen when the match starts (where the browser allows it).
      if (document.body.classList.contains('touch') && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      this.overlay.classList.add('hidden');
      onStart(id);
    };
    const onKey = (e: KeyboardEvent) => {
      const i = ['1', '2', '3'].indexOf(e.key);
      if (i >= 0) go(ids[i]);
    };
    window.addEventListener('keydown', onKey);
    this.overlay.querySelectorAll<HTMLElement>('.hero').forEach((el) => el.addEventListener('click', () => go(el.dataset.id as HeroId)));
  }

  result(won: boolean, seconds: number, kos: number, onAgain: () => void): void {
    this.overlay.innerHTML = `
      <h1 class="${won ? 'mint' : 'coral'}">${won ? 'COURT CLEARED' : 'WASHED OUT'}</h1>
      <p>${Math.floor(seconds)} s &middot; your knockouts: ${kos}</p>
      <p>press R, or click or tap, for a rematch</p>`;
    this.overlay.classList.remove('hidden');
    const again = () => {
      window.removeEventListener('keydown', onKey);
      this.overlay.removeEventListener('click', again);
      this.overlay.classList.add('hidden');
      onAgain();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') again();
    };
    window.addEventListener('keydown', onKey);
    this.overlay.addEventListener('click', again);
  }
}
