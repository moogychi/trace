// ===== Меню на планшетах и телефонах =====

const header = document.querySelector('.header');
const toggle = document.querySelector('.header__toggle');

function setMenu(open) {
  header.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', open);
  toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
}

// На десктопе кнопка открывает полноэкранное меню (см. конец файла),
// на планшете и телефоне — выпадающее
const isDesktop = matchMedia('(min-width: 1200px)');
toggle.addEventListener('click', () => {
  if (isDesktop.matches && window.gsap) openFullMenu();
  else setMenu(!header.classList.contains('is-open'));
});
// Закрываем меню: после выбора пункта, по Esc и по клику мимо
header.querySelectorAll('.header__nav a').forEach((link) => {
  link.addEventListener('click', () => setMenu(false));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setMenu(false);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.header__nav, .header__toggle')) setMenu(false);
});


// ===== Ребристое стекло для смены слайдов (WebGL) =====
//
// В начале перехода оба слайда «фотографируются» в картинки, дальше
// видеокарта рисует поверх них стекло одной волной: рёбра накатывают
// от краёв к центру и сразу откатываются, размытие плавно растёт и спадает,
// в самой размытой точке меняется фото, по рёбрам бежит свет. В конце холст
// прячется, и под ним уже настоящий новый слайд — выглядит точно так же,
// поэтому шва не видно.

const hero = document.querySelector('.hero');
const bg = hero.querySelector('.hero__bg');
const glassCanvas = hero.querySelector('.hero__glass');
const ACCENT = '#4e6365';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

const GLASS_TIME = 4600; // длительность перехода, мс
const SWAP_AT = 0.5;     // когда под холстом меняется настоящий слайд

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uA;      // слайд «было»
uniform sampler2D uB;      // слайд «стало»
uniform vec2 uRes;         // размер холста в пикселях
uniform float uT;          // ход перехода 0…1
uniform float uMix;        // доля нового слайда
uniform float uStrip;      // ширина ребра в пикселях
uniform float uDpr;
uniform float uTime;       // секунды с начала перехода — для бегущего света
in vec2 vUv;
out vec4 outColor;

const float PI = 3.14159265;
const float BLUR = 0.25;   // сила размытия: 0 — без размытия, 1 — как было

float ease(float x) {
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0;
}

// Размытие — вспышка вокруг середины перехода (0.32–0.66), смягчает смену фото.
// Пока рёбра наезжают и расходятся, фото под ними видно
float blurCurve(float t) {
  if (t < 0.5) return 0.5 - 0.5 * cos(PI * clamp((t - 0.32) / 0.18, 0.0, 1.0));
  return 0.5 + 0.5 * cos(PI * clamp((t - 0.5) / 0.16, 0.0, 1.0));
}

// Насколько место «под стеклом». Одна непрерывная волна: стекло накатывает
// от краёв к центру и тут же откатывается обратно, без остановки
float glassPower(float x) {
  float p = 1.0 - abs(2.0 * x - 1.0); // 0 у краёв, 1 в центре
  float comeIn = ease((uT / 0.6 - p * 0.5) / 0.5);
  float goOut = 1.0 - ease(((uT - 0.4) / 0.6 - (1.0 - p) * 0.5) / 0.5);
  return comeIn * goOut;
}

// Размытие: уменьшенная копия картинки (mip) + 16 точек по спирали
vec3 blurred(sampler2D tex, vec2 uv, float radius) {
  if (radius < 0.5) return texture(tex, uv).rgb;
  float lod = log2(max(radius / 4.0, 1.0));
  vec3 sum = vec3(0.0);
  for (int k = 0; k < 16; k++) {
    float fk = float(k) + 0.5;
    float r = sqrt(fk / 16.0) * radius;
    float a = fk * 2.39996;
    vec2 p = uv + vec2(cos(a), sin(a)) * r / uRes;
    sum += textureLod(tex, clamp(p, vec2(0.001), vec2(0.999)), lod).rgb;
  }
  return sum / 16.0;
}

void main() {
  vec2 px = vUv * uRes;
  float power = glassPower(vUv.x);

  // Рёбра медленно плывут вбок, пока идёт переход
  float ribX = px.x + uT * uStrip * 1.5;
  float local = fract(ribX / uStrip); // 0…1 поперёк ребра
  float nx = local * 2.0 - 1.0;

  // Ребро — выпуклая линза. Сдвиг плавно уходит в ноль к краям ребра,
  // поэтому на стыках нет резких швов и тёмных линий
  float shift = nx * (1.0 - pow(abs(nx), 4.0)) * uStrip * 1.1 * power;
  vec2 uv = vUv + vec2(shift / uRes.x, 0.0);

  // Размытие: лёгкая матовость стекла + умеренная вспышка на смене фото
  // (к центру экрана сильнее)
  float centre = smoothstep(0.0, 1.0, 1.0 - abs(2.0 * vUv.x - 1.0));
  float radius = BLUR * (power * 2.9 + blurCurve(uT) * mix(20.0, 29.0, centre) * mix(0.8, 1.0, power)) * uDpr;

  vec3 col;
  if (uMix <= 0.0) col = blurred(uA, uv, radius);
  else if (uMix >= 1.0) col = blurred(uB, uv, radius);
  else col = mix(blurred(uA, uv, radius), blurred(uB, uv, radius), uMix);

  // Объём ребра — едва заметный, плавный к краям, без линий на стыках
  float bulge = 0.5 + 0.5 * cos(PI * nx);
  float shade = mix(0.975, 1.015, bulge);

  // Световая волна бежит по диагонали через все рёбра — мягкий размытый перелив
  float diag = (px.x + px.y * 0.8) / (uStrip * 11.0) - uTime * 0.3;
  float sweep = pow(0.5 + 0.5 * cos(2.0 * PI * diag), 4.0);

  col *= mix(1.0, shade, power);
  col += sweep * (0.035 + 0.05 * bulge) * power;

  outColor = vec4(col, 1.0);
}`;

// «Фотография» слайда: рисуем его картинки на холст так же, как их
// расставил браузер (позиция, cover/fill, отражение)
function isFlipped(el) {
  let flipped = false;
  for (let node = el; node && node !== bg; node = node.parentElement) {
    const t = getComputedStyle(node).transform;
    if (t && t !== 'none' && parseFloat(t.slice(t.indexOf('(') + 1)) < 0) {
      flipped = !flipped;
    }
  }
  return flipped;
}

function snapshot(slide, width, height, dpr) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  const base = bg.getBoundingClientRect();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, width, height);

  slide.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left - base.left;
    const y = r.top - base.top;

    if (el.tagName === 'IMG') {
      if (!el.complete || !el.naturalWidth) return;
      const nw = el.naturalWidth;
      const nh = el.naturalHeight;
      let sx = 0, sy = 0, sw = nw, sh = nh;
      if (getComputedStyle(el).objectFit === 'cover') {
        const s = Math.max(r.width / nw, r.height / nh);
        sw = r.width / s;
        sh = r.height / s;
        sx = (nw - sw) / 2;
        sy = (nh - sh) / 2;
      }
      ctx.save();
      ctx.globalAlpha = parseFloat(getComputedStyle(el).opacity);
      if (isFlipped(el)) {
        ctx.translate(x + r.width, y);
        ctx.scale(-1, 1);
        ctx.drawImage(el, sx, sy, sw, sh, 0, 0, r.width, r.height);
      } else {
        ctx.drawImage(el, sx, sy, sw, sh, x, y, r.width, r.height);
      }
      ctx.restore();
    } else if (el.classList.contains('hero__glow')) {
      // Размытое пятно рисуем тенью: так работает во всех браузерах
      const far = 100000;
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.shadowColor = ACCENT;
      ctx.shadowBlur = 120 * dpr;
      ctx.shadowOffsetX = far * dpr;
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - far, y, r.width, r.height, 50);
      else ctx.rect(x - far, y, r.width, r.height);
      ctx.fill();
      ctx.restore();
    } else if (el.classList.contains('hero__shade')) {
      const g = ctx.createLinearGradient(0, y, 0, y + r.height);
      g.addColorStop(0, 'rgba(0,0,0,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, r.width, r.height);
    }
  });
  return canvas;
}

function createGlass() {
  const gl = glassCanvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) return null;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  // Один большой треугольник на весь экран
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = {};
  ['uA', 'uB', 'uRes', 'uT', 'uMix', 'uStrip', 'uDpr', 'uTime'].forEach((name) => {
    u[name] = gl.getUniformLocation(program, name);
  });
  gl.uniform1i(u.uA, 0);
  gl.uniform1i(u.uB, 1);

  const textures = [gl.createTexture(), gl.createTexture()];
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  function upload(unit, image) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  return {
    // Подготовка: размеры и «фотографии» двух слайдов
    prepare(fromSlide, toSlide) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = bg.clientWidth;
      const height = bg.clientHeight;
      glassCanvas.width = Math.round(width * dpr);
      glassCanvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, glassCanvas.width, glassCanvas.height);

      const strip = Math.max(36, Math.round(width / 22)) * dpr;
      gl.uniform2f(u.uRes, glassCanvas.width, glassCanvas.height);
      gl.uniform1f(u.uStrip, strip);
      gl.uniform1f(u.uDpr, dpr);

      upload(0, snapshot(fromSlide, width, height, dpr));
      upload(1, snapshot(toSlide, width, height, dpr));
    },
    draw(t, seconds = 0) {
      gl.uniform1f(u.uT, t);
      gl.uniform1f(u.uTime, seconds);
      // Фото плавно растворяется одно в другом (прозрачностью)
      const m = Math.min(Math.max((t - 0.36) / 0.28, 0), 1);
      gl.uniform1f(u.uMix, m * m * (3 - 2 * m));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

let glass = null;
try {
  glass = createGlass();
} catch (err) {
  console.warn('Стекло недоступно, будет простая смена слайдов:', err);
}

// Браузер может забрать видеокарту (нехватка памяти, смена видеокарты
// на ноутбуке) — тогда дальше меняем слайды просто плавно
glassCanvas.addEventListener('webglcontextlost', () => {
  glass = null;
});


// ===== Слайдер первого экрана: смена каждые 9 секунд, клик по номеру, свайп =====

const slides = hero.querySelectorAll('.hero__slide');
const steps = hero.querySelectorAll('button.hero__step');
const delay = 9000;
let current = 0;
let timer;
let busy = false;
let clouds = null; // движение облаков (GSAP), создаётся ниже

// Облака плывут, только пока открыт первый слайд и не идёт смена через стекло
function syncClouds() {
  if (!clouds) return;
  clouds.paused(!slides[0].classList.contains('is-active') || hero.classList.contains('is-glass'));
}

function setSlide(index) {
  slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
  syncClouds();
}

// Во время смены через стекло всё движение в слайдах замирает — «фото» совпадает с экраном
function setGlass(on) {
  hero.classList.toggle('is-glass', on);
  syncClouds();
}

function setSteps(index) {
  steps.forEach((step, i) => {
    step.classList.toggle('is-active', i === index);
    // Для программ чтения с экрана: какой слайд сейчас открыт
    if (i === index) step.setAttribute('aria-current', 'true');
    else step.removeAttribute('aria-current');
  });
}

function startTimer() {
  clearTimeout(timer);
  timer = setTimeout(() => show(current + 1), delay);
}

// Переход через стекло. Если стекло недоступно — просто плавная смена
function transition(from, to) {
  busy = true;
  setGlass(true);

  try {
    if (!glass || reduceMotion.matches) throw new Error('no glass');
    glass.prepare(slides[from], slides[to]);
  } catch (err) {
    setGlass(false);
    setSlide(to);
    setTimeout(() => { busy = false; }, 700);
    return;
  }

  glass.draw(0);
  glassCanvas.classList.add('is-on');
  let swapped = false;
  let elapsed = 0;
  let last = performance.now();

  function frame(now) {
    // Видеокарту забрали посреди перехода — просто завершаем смену
    if (!glass) {
      setSlide(to);
      glassCanvas.classList.remove('is-on');
      setGlass(false);
      busy = false;
      return;
    }
    // Шаг не больше 50 мс: после скрытой вкладки анимация продолжится, а не перескочит
    elapsed += Math.min(now - last, 50);
    last = now;
    const t = Math.min(elapsed / GLASS_TIME, 1);
    glass.draw(t, elapsed / 1000);
    if (t >= SWAP_AT && !swapped) {
      swapped = true;
      setSlide(to);
    }
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      glassCanvas.classList.remove('is-on');
      setGlass(false);
      busy = false;
    }
  }
  requestAnimationFrame(frame);
}

function show(index, animate = true) {
  const next = (index + slides.length) % slides.length;
  // Пока идёт переход или слайд уже открыт — ничего не делаем
  if (busy || (animate && next === current)) return;
  const prev = current;
  current = next;
  setSteps(current);
  if (animate) transition(prev, next);
  else setSlide(current);
  startTimer();
}

// Когда вкладка скрыта — слайдер на паузе, при возвращении отсчёт идёт заново
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(timer);
  } else {
    setSteps(-1);
    void hero.offsetWidth; // перезапуск полоски
    setSteps(current);
    startTimer();
  }
});

hero.style.setProperty('--slide-delay', delay + 'ms');
steps.forEach((step, i) => step.addEventListener('click', () => show(i)));

// Свайп считается, только если палец ушёл вбок больше, чем вверх-вниз
let touch = null;
hero.addEventListener('touchstart', (e) => {
  touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
hero.addEventListener('touchend', (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    show(current + (dx < 0 ? 1 : -1));
  }
  touch = null;
});

// Облака на первом слайде без конца плывут вверх. Два одинаковых слоя со сдвигом
// на полцикла: верхний (B) плавно исчезает и появляется, прикрывая момент,
// когда нижний (A) начинает путь заново, — поэтому движение непрерывное.
const cloudLayers = hero.querySelectorAll('.hero__clouds');

if (window.gsap && cloudLayers.length === 2 && !reduceMotion.matches) {
  const [cloudsA, cloudsB] = cloudLayers;
  const CYCLE = 24; // секунд на один проход снизу вверх
  const half = CYCLE / 2;
  const fade = CYCLE * 0.15;

  clouds = gsap.timeline({ repeat: -1 })
    .fromTo(cloudsA, { yPercent: 12 }, { yPercent: -12, duration: CYCLE, ease: 'none' }, 0)
    // B начинает с середины пути: первую половину цикла доезжает до конца…
    .fromTo(cloudsB, { yPercent: 0, opacity: 1 }, { yPercent: -12, duration: half, ease: 'none' }, 0)
    .to(cloudsB, { opacity: 0, duration: fade, ease: 'none' }, half - fade)
    // …а вторую — снова снизу до середины, проявляясь
    .fromTo(cloudsB, { yPercent: 12 }, { yPercent: 0, duration: half, ease: 'none', immediateRender: false }, half)
    .to(cloudsB, { opacity: 1, duration: fade, ease: 'none' }, half);
}

show(0, false);


// ===== Плавный скролл (Lenis) и анимации при скролле (GSAP) =====
//
// Lenis сглаживает прокрутку колёсиком и тачпадом. Его ход передаём GSAP,
// чтобы анимации, привязанные к скроллу (ScrollTrigger), шли с ним в такт.

let lenis = null;

if (window.gsap && window.ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger);
}

if (window.Lenis && window.gsap && !reduceMotion.matches) {
  lenis = new Lenis({
    lerp: 0.09,          // мягкость: меньше — плавнее и «тяжелее»
    wheelMultiplier: 0.9,
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

// Ссылки меню на разделы (#about и т. п.) — плавно, через Lenis
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href');
    // Ссылка «#» (логотип) — наверх страницы
    const target = href === '#' ? document.body : document.querySelector(href);
    if (!target) return; // раздела пока нет
    e.preventDefault();
    // force — прокрутка сработает, даже если скролл был заблокирован открытым меню
    if (lenis) lenis.scrollTo(target, { duration: 1.4, force: true });
    else target.scrollIntoView({ behavior: 'smooth' });
  });
});


// ===== Появление блоков при скролле (GSAP + ScrollTrigger) =====
//
// Анимация проигрывается каждый раз, когда блок появляется на экране;
// когда блок полностью уходит с экрана, он незаметно возвращается в начало.
// Начальное (скрытое) состояние задаёт скрипт: если GSAP не загрузился,
// всё просто видно сразу.

// Разбиваем строку заголовка на буквы: каждая — отдельный span
function splitChars(line) {
  const text = line.textContent.trim();
  line.textContent = '';
  const chars = [];
  [...text].forEach((ch) => {
    if (ch === ' ') {
      line.append(' ');
      return;
    }
    const span = document.createElement('span');
    span.className = 'char';
    span.textContent = ch;
    line.append(span);
    chars.push(span);
  });
  return chars;
}

if (window.gsap && window.ScrollTrigger && !reduceMotion.matches) {
  // Запуск при каждом появлении на экране (сверху или снизу),
  // сброс — когда элемент полностью ушёл с экрана
  // resetEl — чей уход с экрана сбрасывает анимацию (по умолчанию сам элемент)
  const replay = (trigger, anim, start = 'top 85%', end = 'bottom 15%', resetEl = trigger) => {
    ScrollTrigger.create({
      trigger, start, end,
      onEnter: () => anim.play(),
      onEnterBack: () => anim.play(),
    });
    ScrollTrigger.create({
      trigger: resetEl, start: 'top bottom', end: 'bottom top',
      onLeave: () => anim.pause(0),
      onLeaveBack: () => anim.pause(0),
    });
  };
  const timeline = () => gsap.timeline({ paused: true });

  // Заголовки: буквы по очереди выезжают снизу из-под края строки
  document.querySelectorAll('.about__title, .comfort__title, .dominant__title').forEach((title) => {
    const chars = [...title.querySelectorAll('.about__line, .comfort__line, .dominant__line')].flatMap(splitChars);
    replay(title, timeline().from(chars, {
      yPercent: 110,
      duration: 0.8,
      ease: 'power2.out',
      stagger: 0.016,
    }));
  });

  // Метка раздела и абзац — просто проявляются
  document.querySelectorAll('.about .label, .about__text, .dominant .label, .dominant__address').forEach((el) => {
    replay(el, timeline().from(el, { opacity: 0, duration: 0.8, ease: 'power1.out' }), 'top 90%');
  });

  // Картинки: шторка снизу вверх (начинается, как только картинка показалась
  // из-под нижнего края), фото внутри заметно отдаляется,
  // дальше при скролле фото движется медленнее страницы (параллакс)
  const reveal = (frame, img, zoomFrom) => {
    replay(frame, timeline()
      .fromTo(frame,
        { clipPath: 'inset(100% 0% 0% 0%)' },
        { clipPath: 'inset(0% 0% 0% 0%)', duration: 2, ease: 'power2.inOut' })
      .from(img, { scale: zoomFrom, duration: 2.8, ease: 'power2.out' }, 0),
    'top 98%');
  };
  const parallax = (frame, img, from, to) => {
    gsap.fromTo(img, { y: from }, {
      y: to,
      ease: 'none',
      scrollTrigger: { trigger: frame, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  };

  const photoFrame = document.querySelector('.about__photo');
  const photo = photoFrame.querySelector('img');
  reveal(photoFrame, photo, 1.35);
  parallax(photoFrame, photo, '-7%', '7%');

  // Блок «Локация»: пока листаешь, блок стоит на месте, а фото из маленькой
  // рамки разворачивается на весь экран; заголовок и текст плавно уходят.
  // Листаешь назад — фото сворачивается обратно
  const dominant = document.querySelector('.dominant');
  const smallPhoto = dominant.querySelector('.dominant__photo');
  const expand = dominant.querySelector('.dominant__expand');
  dominant.classList.add('is-expandable');

  // Стартовое положение: слой на весь экран уменьшен и обрезан так,
  // что видно ровно маленькую рамку
  const startOf = () => {
    const box = dominant.getBoundingClientRect();
    const r = smallPhoto.getBoundingClientRect();
    const w = expand.offsetWidth;
    const h = expand.offsetHeight;
    const scale = Math.max(r.width / w, r.height / h);
    const insetX = (w - r.width / scale) / 2;
    const insetY = (h - r.height / scale) / 2;
    return {
      scale,
      x: r.left - box.left + r.width / 2 - w / 2,
      y: r.top - box.top + r.height / 2 - h / 2,
      clipPath: `inset(${insetY}px ${insetX}px ${insetY}px ${insetX}px)`,
    };
  };

  gsap.timeline({
    scrollTrigger: {
      trigger: dominant,
      start: 'top top',
      end: '+=170%',
      pin: true,
      scrub: 1,
      invalidateOnRefresh: true,
    },
  })
    .fromTo(expand,
      {
        x: () => startOf().x,
        y: () => startOf().y,
        scale: () => startOf().scale,
        clipPath: () => startOf().clipPath,
        transformOrigin: '50% 50%',
      },
      { x: 0, y: 0, scale: 1, clipPath: 'inset(0px 0px 0px 0px)', ease: 'power1.inOut', duration: 1 }, 0)
    // остальное уходит (через filter, чтобы не мешать анимациям появления)
    .fromTo('.dominant__center, .dominant__text, .dominant__link, .dominant__dot, .dominant .label, .dominant__address',
      { filter: 'opacity(1)' },
      { filter: 'opacity(0)', ease: 'none', duration: 0.4 }, 0)
    // Глубина: рамка растёт, а фото внутри отдаляется и чуть смещается —
    // будто камера отъезжает; текст вокруг уходит назад
    .fromTo(expand.querySelector('img'),
      { scale: 1.45, yPercent: 6 },
      { scale: 1, yPercent: 0, ease: 'power1.inOut', duration: 1 }, 0)
    .fromTo('.dominant__center, .dominant__text, .dominant .label, .dominant__address',
      { scale: 1, y: 0 },
      { scale: 0.92, y: -40, ease: 'power1.in', duration: 0.5 }, 0)
    // когда фото на весь экран — медленное приближение, пока блок ещё стоит
    .to(expand.querySelector('img'), { scale: 1.08, ease: 'none', duration: 0.4 }, 1);

  // Блок «Локация»: текст проявляется, бирюзовая плашка прочерчивается
  // под словами «7 трлн рублей инвестиций», от неё к центру блока бежит линия,
  // на стыке появляется квадратик
  const dominantText = document.querySelector('.dominant__text');
  const mark = dominantText.querySelector('.dominant__mark');
  const [linkMain, linkBar] = document.querySelectorAll('.dominant__link path');
  const draw = (path) => {
    const length = path.getTotalLength();
    return [path, { strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0 }];
  };
  const [mainEl, mainFrom, mainTo] = draw(linkMain);
  const [barEl, barFrom, barTo] = draw(linkBar);

  replay(dominantText, timeline()
    .from(dominantText, { opacity: 0, duration: 0.8, ease: 'power1.out' })
    .fromTo(mark,
      { backgroundSize: '0% 100%', color: '#2b2b2b' },
      { backgroundSize: '100% 100%', color: '#ffffff', duration: 0.9, ease: 'power2.inOut' }, 0.4)
    // линия растёт сразу после плашки и быстро
    .fromTo(mainEl, mainFrom, { ...mainTo, duration: 0.7, ease: 'power2.inOut' }, 1.3)
    .fromTo(barEl, barFrom, { ...barTo, duration: 0.35, ease: 'power2.out' }, 1.95)
    .from('.dominant__dot', { scale: 0, duration: 0.4, ease: 'back.out(3)' }, 1.95),
  'top 95%', 'bottom 15%', document.querySelector('.dominant__inner'));

  const media = document.querySelector('.comfort__media');
  const towers = media.querySelector('.comfort__towers');
  gsap.set(towers, { transformOrigin: '50% 100%' });
  reveal(media, towers, 1.12);
  parallax(media, towers, 60, -60);
  parallax(media, media.querySelector('.comfort__sky'), 25, -25); // небо медленнее — глубина

  // Цифры: строки по очереди — рамка прорисовывается слева направо,
  // цифра спокойно набегает, линия под строкой прочерчивается, подпись проявляется
  document.querySelectorAll('.fact').forEach((fact, i) => {
    const value = fact.querySelector('.fact__value');
    const num = fact.querySelector('.fact__num');
    const target = Number(num.textContent);
    num.dataset.target = target;
    const counter = { n: 0 };
    const at = i * 0.25; // строки по очереди

    replay(fact.parentElement, timeline()
      .from(fact.querySelector('.fact__rule'), { scaleX: 0, duration: 1.8, ease: 'power2.inOut' }, at)
      .fromTo(value,
        { clipPath: 'inset(0% 100% 0% 0%)' },
        { clipPath: 'inset(0% -12px 0% 0%)', duration: 1.5, ease: 'power2.out' }, at + 0.15)
      // Спокойный счётчик: начинает близко к итогу (~90%) и быстро доходит
      .fromTo(counter, { n: Math.round(target * 0.9) }, {
        n: target,
        duration: 1.4,
        ease: 'power2.out',
        onUpdate: () => { num.textContent = Math.round(counter.n); },
      }, at + 0.15)
      .from(fact.querySelector('.fact__label'), { opacity: 0, duration: 0.8, ease: 'power1.out' }, at + 0.5),
    'top 85%', 'bottom 15%');
  });

  // Когда загрузился шрифт: фиксируем ширину чисел по итоговому значению
  // (рамка не прыгает во время счёта) и пересчитываем позиции анимаций
  document.fonts.ready.then(() => {
    document.querySelectorAll('.fact__num').forEach((num) => {
      const shown = num.textContent;
      num.style.minWidth = '';
      num.textContent = num.dataset.target;
      num.style.minWidth = `${num.offsetWidth}px`;
      num.textContent = shown;
    });
    ScrollTrigger.refresh();
  });
}


// ===== Полноэкранное меню (десктоп) =====
//
// Открытие одним движением: белая шторка опускается сверху, и почти сразу
// за ней, внахлёст, опускается полоса стекла. Верхняя строка (логотип,
// «выбрать офис», кнопка) стоит на тех же местах — шторка просто
// «перекрашивает» её в тёмный. Остальное проявляется прозрачностью.
// При наведении на пункт его картинка открывается шторкой снизу вверх.

const menuEl = document.querySelector('.menu');
const menuPanel = menuEl.querySelector('.menu__panel');
const menuGlass = menuEl.querySelector('.menu__glass');
const menuLinks = [...menuEl.querySelectorAll('.menu__link')];
const menuPhotos = [...menuEl.querySelectorAll('.menu__pic')];
const menuFade = menuEl.querySelectorAll('.menu__link, .menu__photo, .menu__contacts');
const menuCanvas = menuEl.querySelector('.menu__canvas');
let menuTl = null;
let menuPhotoIndex = menuLinks.findIndex((link) => link.classList.contains('is-active'));
let menuPhotoZ = 1;

menuPhotos[menuPhotoIndex].classList.add('is-shown');

function buildMenuTimeline() {
  return gsap.timeline({ paused: true })
    // Одна шторка из двух полос: белая раскрывается сверху вниз (содержимое стоит
    // на месте), стекло съезжает сверху в том же темпе. Край стекла всегда ниже
    // края белой части — полосы едут вместе, без второго шага
    .fromTo(menuPanel,
      { clipPath: 'inset(0% 0% 100% 0%)' },
      { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.2, ease: 'power3.inOut' }, 0)
    .fromTo(menuGlass,
      { yPercent: -100 },
      { yPercent: 0, duration: 1.2, ease: 'power3.inOut' }, 0)
    .fromTo(menuFade,
      { opacity: 0 },
      { opacity: 1, duration: 0.6, ease: 'power1.out', stagger: 0.05 }, 0.7);
}

// Картинка пункта в покое медленно отдаляется
function idleZoom(img, from = 1.18) {
  gsap.killTweensOf(img);
  gsap.fromTo(img, { scale: from }, { scale: 1, duration: 8, ease: 'power2.out' });
}

function openFullMenu() {
  if (!menuTl) menuTl = buildMenuTimeline();
  if (menuGlassFx) menuGlassFx.start();
  idleZoom(menuPhotos[menuPhotoIndex].querySelector('img'));
  menuEl.classList.add('is-open');
  menuEl.setAttribute('aria-hidden', 'false');
  toggle.setAttribute('aria-expanded', 'true');
  if (lenis) lenis.stop();
  else document.documentElement.style.overflow = 'hidden';
  menuTl.timeScale(1).play();
}

function closeFullMenu() {
  if (!menuTl || !menuEl.classList.contains('is-open')) return;
  toggle.setAttribute('aria-expanded', 'false');
  if (lenis) lenis.start();
  else document.documentElement.style.overflow = '';
  // закрытие — то же движение назад, чуть быстрее
  menuTl.timeScale(1.4).reverse().eventCallback('onReverseComplete', () => {
    menuEl.classList.remove('is-open');
    if (menuGlassFx) menuGlassFx.stop();
    menuEl.setAttribute('aria-hidden', 'true');
  });
}

menuEl.querySelector('.menu__close').addEventListener('click', closeFullMenu);
menuEl.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeFullMenu));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFullMenu();
});

// Наведение на пункт: он становится чёрным, его картинка открывается шторкой
// снизу вверх (как фото во втором блоке) и дальше медленно отдаляется
menuLinks.forEach((link, i) => {
  link.addEventListener('mouseenter', () => {
    menuLinks.forEach((other) => other.classList.toggle('is-active', other === link));
    if (i === menuPhotoIndex || !window.gsap) return;
    menuPhotoIndex = i;
    const pic = menuPhotos[i];
    const img = pic.querySelector('img');
    pic.classList.add('is-shown');
    pic.style.zIndex = ++menuPhotoZ;
    gsap.killTweensOf(pic);
    gsap.fromTo(pic,
      { clipPath: 'inset(100% 0% 0% 0%)' },
      { clipPath: 'inset(0% 0% 0% 0%)', duration: 1, ease: 'power3.inOut' });
    idleZoom(img, 1.3);
  });
});


// ===== Живое стекло в меню (WebGL) =====
//
// Переливающийся бирюзовый цвет за ребристым стеклом: рёбра-линзы отражают
// и растягивают цвет, по ним пробегают блики. Рисуется только пока меню
// открыто. Картинка уменьшена (0.6) — текстура размытая, так легче видеокарте.

const MENU_GLASS_FRAGMENT = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

// Цвета как в макете: от глубокого бирюзового до светлой морской волны
vec3 palette(float t) {
  vec3 c1 = vec3(0.06, 0.19, 0.20);
  vec3 c2 = vec3(0.19, 0.41, 0.42);
  vec3 c3 = vec3(0.44, 0.69, 0.68);
  vec3 c4 = vec3(0.80, 0.92, 0.90);
  t = clamp(t, 0.0, 1.0);
  if (t < 0.4) return mix(c1, c2, t / 0.4);
  if (t < 0.8) return mix(c2, c3, (t - 0.4) / 0.4);
  return mix(c3, c4, (t - 0.8) / 0.2);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / uRes.y;

  // Рёбра: около 52 на ширину экрана
  float ribs = 52.0;
  float x = uv.x * ribs;
  float i = floor(x);
  float local = fract(x);
  float nx = local * 2.0 - 1.0;

  // Ребро — линза: цвет внутри отражён и растянут, у каждого ребра своё смещение
  float sx = (i + 0.5 - nx * 0.9 + sin(i * 1.7) * 0.3) / ribs;

  // Цвет медленно течёт; по вертикали растянут — получаются полосы-переливы
  float t = uTime * 0.06;
  vec2 p = vec2(sx * aspect * 2.2, uv.y * 0.55);
  float f = (fbm(p + vec2(t, -t * 0.7)) + 0.35 * fbm(p * 2.3 + vec2(-t * 1.3, t))) / 1.35;

  // Волна яркости идёт наискось через рёбра — зигзаги, как на макете
  float zig = sin(uv.y * 6.0 + abs(nx) * 2.0 + i * 0.9 + uTime * 0.8) * 0.5 + 0.5;
  float v = mix(f, f * 0.7 + zig * 0.3, 0.5);
  vec3 col = palette(pow(v, 1.3) * 1.25);

  // Объём ребра, блик и лёгкий стык
  float bulge = sqrt(max(0.0, 1.0 - nx * nx));
  col *= mix(0.74, 1.08, bulge);
  float spec = smoothstep(0.55, 0.75, local) * (1.0 - smoothstep(0.75, 0.9, local));
  col += spec * 0.1 * (0.5 + 0.5 * sin(uTime * 0.9 + i * 0.6 + uv.y * 3.0));
  col *= 1.0 - (1.0 - smoothstep(0.0, 0.06, local)) * 0.2;

  gl_FragColor = vec4(col, 1.0);
}`;

function createMenuGlass(canvas) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
  if (!gl) return null;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER,
    'attribute vec2 aPos; varying vec2 vUv; void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, MENU_GLASS_FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(program, 'uRes');
  const uTime = gl.getUniformLocation(program, 'uTime');

  let running = false;
  let time = 0;
  let last = 0;

  function frame(now) {
    if (!running) return;
    time += Math.min(now - last, 50) / 1000;
    last = now;
    const w = Math.round(canvas.clientWidth * 0.6);
    const h = Math.round(canvas.clientHeight * 0.6);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uTime, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.classList.add('is-live');
    requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    },
    stop() {
      running = false;
    },
  };
}

let menuGlassFx = null;
try {
  menuGlassFx = reduceMotion.matches ? null : createMenuGlass(menuCanvas);
} catch (err) {
  console.warn('Живое стекло в меню недоступно, будет картинка:', err);
}
