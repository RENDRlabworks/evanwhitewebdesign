/**
 * Evan White Web Design: page behaviour.
 *
 * Everything here is progressive. Without JS the page is complete and static.
 * Motion is only added when html.motion is present (set in <head> when the
 * visitor has not asked for reduced motion). Scroll-driven work happens in a
 * single rAF pass, reading layout first and writing transforms after.
 */

const root = document.documentElement;
const motionOK = root.classList.contains('motion');
const desktopMQ = window.matchMedia('(min-width: 900px)');

const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ------------------------------------------------------------------------
   Text splitting
   ------------------------------------------------------------------------ */

/** Split a heading into clipped words so each can rise into place. */
function splitWords(el) {
  const text = el.textContent.trim().replace(/\s+/g, ' ');
  el.setAttribute('aria-label', text);
  el.textContent = '';
  text.split(' ').forEach((word, i) => {
    const outer = document.createElement('span');
    outer.className = 'sw';
    outer.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('span');
    inner.className = 'sw__i';
    inner.style.setProperty('--i', i);
    inner.textContent = word;
    outer.appendChild(inner);
    el.appendChild(outer);
    el.appendChild(document.createTextNode(' '));
  });
}

/** Wrap quote words in spans for the scroll-linked light-up. Text stays readable. */
function wrapQuoteWords(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.textContent = '';
  words.forEach((word, i) => {
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = word;
    el.appendChild(span);
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
  });
  return [...el.querySelectorAll('.w')];
}

/** Give buttons a second, ink-colored label for the hover swap. */
function wrapButtons() {
  document.querySelectorAll('.btn').forEach((btn) => {
    const label = btn.textContent.trim();
    const inner = document.createElement('span');
    inner.className = 'btn__inner';
    const a = document.createElement('span');
    a.textContent = label;
    const b = document.createElement('span');
    b.textContent = label;
    b.setAttribute('aria-hidden', 'true');
    inner.append(a, b);
    btn.textContent = '';
    btn.appendChild(inner);
  });
}

/* ------------------------------------------------------------------------
   Reveals
   ------------------------------------------------------------------------ */

function initReveals() {
  const targets = [...document.querySelectorAll('[data-reveal], [data-plate]:not([data-hero-plate])')];

  if (!('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-in'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      // Items entering together get a short stagger, in document order.
      const entering = entries.filter((e) => e.isIntersecting).map((e) => e.target);
      entering.forEach((el, i) => {
        el.style.setProperty('--d', `${Math.min(i, 4) * 80}ms`);
        el.classList.add('is-in');
        io.unobserve(el);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0 }
  );
  targets.forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------------------
   Navigation: scrolled state, hide on scroll down, current section
   ------------------------------------------------------------------------ */

const nav = document.querySelector('[data-nav]');
let lastY = window.scrollY;

function updateNav(y) {
  nav.classList.toggle('is-scrolled', y > 8);
  const menuOpen = nav.classList.contains('is-open');
  const focusInside = nav.contains(document.activeElement) && document.activeElement !== document.body;
  if (!menuOpen && !focusInside && motionOK) {
    const delta = y - lastY;
    if (y > 160 && delta > 4) nav.classList.add('is-hidden');
    else if (delta < -4 || y < 160) nav.classList.remove('is-hidden');
  }
  lastY = y;
}

nav.addEventListener('focusin', () => nav.classList.remove('is-hidden'));

function initCurrentSection() {
  if (!('IntersectionObserver' in window)) return;
  const links = new Map(
    [...document.querySelectorAll('.nav__links a')].map((a) => [a.getAttribute('href').slice(1), a])
  );
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const link = links.get(entry.target.id);
        if (!link) return;
        if (entry.isIntersecting) {
          links.forEach((l) => l.removeAttribute('aria-current'));
          link.setAttribute('aria-current', 'true');
        } else if (link.hasAttribute('aria-current')) {
          link.removeAttribute('aria-current');
        }
      });
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );
  links.forEach((_, id) => {
    const section = document.getElementById(id);
    if (section) io.observe(section);
  });
}

/* ------------------------------------------------------------------------
   Mobile menu: focus trap, Escape to close, scroll lock
   ------------------------------------------------------------------------ */

function initMenu() {
  const toggle = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-menu]');
  const label = toggle.querySelector('.nav__toggle-label');
  let closeTimer = 0;

  const focusables = () => [toggle, ...menu.querySelectorAll('a')];

  function open() {
    clearTimeout(closeTimer);
    menu.hidden = false;
    nav.classList.add('is-open');
    nav.classList.remove('is-hidden');
    toggle.setAttribute('aria-expanded', 'true');
    label.textContent = 'Close';
    root.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      menu.classList.add('is-open');
      menu.querySelector('a').focus({ preventScroll: true });
    });
    document.addEventListener('keydown', onKey);
  }

  function close({ returnFocus = true } = {}) {
    menu.classList.remove('is-open');
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    label.textContent = 'Menu';
    root.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    closeTimer = setTimeout(() => { menu.hidden = true; }, 420);
    if (returnFocus) toggle.focus({ preventScroll: true });
  }

  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const items = focusables();
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  toggle.addEventListener('click', () => {
    toggle.getAttribute('aria-expanded') === 'true' ? close() : open();
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) close({ returnFocus: false });
  });
  desktopMQ.addEventListener('change', (e) => {
    if (e.matches && toggle.getAttribute('aria-expanded') === 'true') close({ returnFocus: false });
  });
}

/* ------------------------------------------------------------------------
   Hero scroll scene (desktop, motion allowed)
   The latest project grows from its corner until it fills the stage.
   ------------------------------------------------------------------------ */

const hero = {
  section: document.querySelector('[data-hero]'),
  stage: document.querySelector('[data-hero-stage]'),
  plate: document.querySelector('[data-hero-plate]'),
  fades: [...document.querySelectorAll('[data-hero-fade], .hero__caption')],
  maxScale: 1,
  active: false,
};

function measureHero() {
  hero.active = motionOK && desktopMQ.matches;
  if (!hero.active) {
    hero.plate.style.transform = '';
    hero.fades.forEach((el) => { el.style.opacity = ''; el.style.transform = ''; });
    return;
  }
  const cs = getComputedStyle(hero.stage);
  const contentW = hero.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const navH = parseFloat(getComputedStyle(root).getPropertyValue('--nav-h')) || 80;
  // Offsets ignore transforms, so this is safe mid-scroll and mid-load. Walk the
  // offsetParent chain because a transformed ancestor can become the offsetParent.
  const w = hero.plate.offsetWidth;
  const h = hero.plate.offsetHeight;
  let top = 0;
  for (let n = hero.plate; n && n !== hero.stage; n = n.offsetParent) top += n.offsetTop;
  const bottom = top + h;
  hero.maxScale = Math.max(1, Math.min(contentW / w, (bottom - navH - 16) / h));
}

function updateHero(vh) {
  if (!hero.active) return;
  const rect = hero.section.getBoundingClientRect();
  const range = Math.max(1, hero.section.offsetHeight - vh);
  const p = clamp(-rect.top / range);
  const e = easeInOut(clamp(p / 0.72));
  const s = 1 + (hero.maxScale - 1) * e;
  hero.plate.style.transform = `scale(${s.toFixed(4)})`;
  const fade = clamp(1 - e * 1.3);
  const lift = (-e * 48).toFixed(2);
  hero.fades.forEach((el) => {
    el.style.opacity = fade.toFixed(3);
    el.style.transform = `translate3d(0, ${lift}px, 0)`;
  });
}

/* ------------------------------------------------------------------------
   Testimonials: words light up with scroll position
   ------------------------------------------------------------------------ */

const quotes = [];

function initQuotes() {
  document.querySelectorAll('[data-words]').forEach((el) => {
    quotes.push({ el, words: wrapQuoteWords(el), lit: 0 });
  });
}

function updateQuotes(vh) {
  // Read all positions first, then write classes.
  const progress = quotes.map((q) => {
    const r = q.el.getBoundingClientRect();
    return clamp((vh * 0.95 - r.top) / (r.height + vh * 0.25));
  });
  quotes.forEach((q, i) => {
    const target = Math.round(progress[i] * q.words.length);
    if (target === q.lit) return;
    const [from, to] = target > q.lit ? [q.lit, target] : [target, q.lit];
    for (let w = from; w < to; w++) q.words[w].classList.toggle('is-lit', target > q.lit);
    q.lit = target;
  });
}

/* ------------------------------------------------------------------------
   Single scroll loop
   ------------------------------------------------------------------------ */

let ticking = false;

function onFrame() {
  ticking = false;
  const y = window.scrollY;
  const vh = window.innerHeight;
  updateNav(y);
  updateHero(vh);
  if (motionOK) updateQuotes(vh);
}

function requestTick() {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(onFrame);
  }
}

/* ------------------------------------------------------------------------
   Services link prefill
   ------------------------------------------------------------------------ */

function initPrefill() {
  document.querySelectorAll('[data-prefill]').forEach((link) => {
    link.addEventListener('click', () => {
      const radio = document.querySelector(`input[name="project"][value="${link.dataset.prefill}"]`);
      if (radio) radio.checked = true;
      // Move focus to the form once the scroll has started; no jump.
      setTimeout(() => document.getElementById('f-name').focus({ preventScroll: true }), motionOK ? 700 : 0);
    });
  });
}

/* ------------------------------------------------------------------------
   Contact form
   Posts to the form's action when one is set; otherwise opens a pre-filled email.
   ------------------------------------------------------------------------ */

const EMAIL = 'hello@evanwhite.design';

function initForm() {
  const form = document.querySelector('[data-form]');
  if (!form) return;
  const status = form.querySelector('[data-status]');
  const submit = form.querySelector('[type="submit"]');

  const rules = {
    name: (v) => (v.trim() ? '' : 'Please add your name so I know who to reply to.'),
    email: (v) =>
      !v.trim() ? 'Please add an email address.'
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'That email address looks incomplete.',
    message: (v) => (v.trim().length >= 10 ? '' : 'A sentence or two about the project helps me reply properly.'),
  };

  function validateField(input) {
    const rule = rules[input.name];
    if (!rule) return true;
    const msg = rule(input.value);
    const err = document.getElementById(`${input.id}-err`);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (err) err.textContent = msg;
    return !msg;
  }

  form.querySelectorAll('input[required], textarea[required]').forEach((input) => {
    input.addEventListener('blur', () => { if (input.value) validateField(input); });
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') validateField(input);
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'form__status';
    status.textContent = '';

    const fields = [...form.querySelectorAll('input[required], textarea[required]')];
    const invalid = fields.filter((f) => !validateField(f));
    if (invalid.length) {
      invalid[0].focus();
      status.classList.add('is-error');
      status.textContent = invalid.length === 1 ? 'One field needs a quick look.' : `${invalid.length} fields need a quick look.`;
      return;
    }

    const data = new FormData(form);
    const name = String(data.get('name')).trim().split(' ')[0];

    // Bots fill the hidden field. Pretend all is well and stop.
    if (data.get('company_website')) {
      status.textContent = 'Thanks. Your note is on its way.';
      form.reset();
      return;
    }

    const action = form.getAttribute('action');
    if (action && /^https?:\/\//.test(action)) {
      submit.disabled = true;
      status.textContent = 'Sending…';
      try {
        const res = await fetch(action, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(String(res.status));
        form.reset();
        status.classList.add('is-ok');
        status.textContent = `Thanks, ${name}. Your note is in, and I’ll reply within one working day.`;
      } catch {
        status.classList.add('is-error');
        status.textContent = `That didn’t send. Please email ${EMAIL} and I’ll pick it up from there.`;
      } finally {
        submit.disabled = false;
      }
      return;
    }

    // No endpoint configured: hand off to the visitor's email app.
    const projectLabel = form.querySelector('input[name="project"]:checked + span')?.textContent || 'A project';
    const subject = `${projectLabel} for ${String(data.get('name')).trim()}`;
    const body = [
      String(data.get('message')).trim(),
      '',
      `Budget: ${data.get('budget') || 'Prefer to discuss'}`,
      `Reply to: ${String(data.get('email')).trim()}`,
    ].join('\n');
    window.location.href = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    status.classList.add('is-ok');
    status.textContent = `Your email app should open with the note ready to send. If it doesn’t, write to ${EMAIL}.`;
  });
}

/* ------------------------------------------------------------------------
   Page load sequence, then the GPU scene once the content is settled
   ------------------------------------------------------------------------ */

async function loadSequence() {
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  await Promise.race([fontsReady, new Promise((r) => setTimeout(r, 700))]);
  requestAnimationFrame(() => {
    root.classList.add('is-loaded');
    document.querySelector('.hero__title').classList.add('is-in');
    hero.plate.classList.add('is-in');
    measureHero();
    requestTick();
  });
}

function startGPU() {
  if (!motionOK) return; // Reduced motion keeps the static images.
  if (navigator.connection && navigator.connection.saveData) return;
  const canvas = document.querySelector('.gpu-stage');
  const run = () =>
    import('./gpu/stage.js')
      .then((m) => m.start(canvas))
      .catch((err) => {
        root.classList.remove('gpu-on');
        console.info('[gpu] staying with static images:', err && err.message);
      });
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  // Wait for the load sequence to finish so the GPU never competes with first paint.
  idle(() => setTimeout(run, 900), { timeout: 2000 });
}

/* ------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------ */

if (motionOK) document.querySelectorAll('[data-split]').forEach(splitWords);
wrapButtons();
initReveals();
initCurrentSection();
initMenu();
initPrefill();
initForm();
if (motionOK) initQuotes();
document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

measureHero();
window.addEventListener('scroll', requestTick, { passive: true });
window.addEventListener('resize', () => { measureHero(); requestTick(); });
desktopMQ.addEventListener('change', () => { measureHero(); requestTick(); });

loadSequence();
if (document.readyState === 'complete') startGPU();
else window.addEventListener('load', startGPU, { once: true });
