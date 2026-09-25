// ===== Меню на планшетах и телефонах =====

const header = document.querySelector('.header');
const toggle = document.querySelector('.header__toggle');

function setMenu(open) {
  header.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', open);
  toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
}

toggle.addEventListener('click', () => setMenu(!header.classList.contains('is-open')));
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
  float shift = nx * (1.0 - pow(abs(nx), 4.0)) * uStrip * 0.8 * power;
  vec2 uv = vUv + vec2(shift / uRes.x, 0.0);

  // Размытие: лёгкая матовость стекла + умеренная вспышка на смене фото
  // (к центру экрана сильнее)
  float centre = smoothstep(0.0, 1.0, 1.0 - abs(2.0 * vUv.x - 1.0));
  float radius = (power * 3.6 + blurCurve(uT) * mix(25.0, 36.0, centre) * mix(0.8, 1.0, power)) * uDpr;

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
    } else if (el.classList.contains('hero__light')) {
      // Пятно света на стене: осветление, как mix-blend-mode: screen
      const g = ctx.createLinearGradient(x, 0, x + r.width, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.globalAlpha = parseFloat(getComputedStyle(el).opacity);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = g;
      ctx.fillRect(x, y, r.width, r.height);
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


// ===== Слайдер первого экрана: смена каждые 9 секунд, клик по номеру, свайп =====

const slides = hero.querySelectorAll('.hero__slide');
const steps = hero.querySelectorAll('button.hero__step');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const delay = 9000;
let current = 0;
let timer;
let busy = false;

function setSlide(index) {
  slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
}

function setSteps(index) {
  steps.forEach((step, i) => step.classList.toggle('is-active', i === index));
}

function startTimer() {
  clearTimeout(timer);
  timer = setTimeout(() => show(current + 1), delay);
}

// Переход через стекло. Если стекло недоступно — просто плавная смена
function transition(from, to) {
  busy = true;
  hero.classList.add('is-glass'); // небо замирает, чтобы «фото» совпало с экраном

  try {
    if (!glass || reduceMotion.matches) throw new Error('no glass');
    glass.prepare(slides[from], slides[to]);
  } catch (err) {
    hero.classList.remove('is-glass');
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
      hero.classList.remove('is-glass');
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

show(0, false);


// ===== Вся страница мягко колышется, как ткань =====
//
// Карта волн — картинка с плавными волнами (красный канал — сдвиг по
// горизонтали, зелёный — по вертикали), чуть больше страницы. Она медленно
// плывёт по диагонали, и браузер сдвигает по ней каждую точку страницы.
// Волны повторяются через WAVE_PERIOD пикселей, поэтому карту можно
// бесконечно сдвигать по кругу без скачков. У краёв окна волна затухает,
// чтобы по краям не появлялись пустые полоски.

const WAVE_PERIOD = 640;      // длина волны, px — чем больше, тем положе волны
const WAVE_SHIFT = 18;        // сила изгиба: наибольший сдвиг ±9px
const WAVE_EDGE = 60;         // ширина затухания у краёв, px
const WAVE_SPEED = [34, 22];  // скорость волн, px/с (вбок, вниз)
const WAVE_SCALE = 4;         // карты считаем в 4 раза мельче — их всё равно растягивают

const waveFilter = document.querySelector('#page-wave');
const waveMap = waveFilter.querySelector('.wave-map');
const waveEdges = waveFilter.querySelector('.wave-edges');
const waveShift = waveFilter.querySelector('feDisplacementMap');

function waveCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w / WAVE_SCALE);
  canvas.height = Math.ceil(h / WAVE_SCALE);
  return canvas;
}

// Плавные волны, больше страницы на один период
function drawWaveMap(w, h) {
  const canvas = waveCanvas(w + WAVE_PERIOD, h + WAVE_PERIOD);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  const k = (2 * Math.PI) / WAVE_PERIOD;
  for (let j = 0; j < canvas.height; j++) {
    const y = j * WAVE_SCALE;
    for (let i = 0; i < canvas.width; i++) {
      const x = i * WAVE_SCALE;
      const r = 0.65 * Math.sin(k * (x + y)) + 0.35 * Math.sin(k * (2 * y - x) + 1.3);
      const g = 0.65 * Math.sin(k * (x - 2 * y) + 0.7) + 0.35 * Math.sin(k * (x + y) + 2.4);
      const p = (j * canvas.width + i) * 4;
      img.data[p] = 128 + 127 * r;
      img.data[p + 1] = 128 + 127 * g;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  waveMap.setAttribute('href', canvas.toDataURL());
  waveMap.setAttribute('width', w + WAVE_PERIOD);
  waveMap.setAttribute('height', h + WAVE_PERIOD);
}

// Маска краёв: белая внутри, к краям страницы плавно чернеет
function drawWaveEdges(w, h) {
  const canvas = waveCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const e = WAVE_EDGE / WAVE_SCALE;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'multiply';
  [[0, 0, e, 0], [canvas.width, 0, canvas.width - e, 0],
   [0, 0, 0, e], [0, canvas.height, 0, canvas.height - e]].forEach(([x0, y0, x1, y1]) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#000');
    g.addColorStop(1, '#fff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });
  waveEdges.setAttribute('href', canvas.toDataURL());
  waveEdges.setAttribute('width', w);
  waveEdges.setAttribute('height', h);
}

let waveSize = '';

function fitWave() {
  const w = document.body.offsetWidth;
  const h = document.body.offsetHeight;
  if (waveSize === `${w}x${h}`) return;
  waveSize = `${w}x${h}`;
  drawWaveMap(w, h);
  drawWaveEdges(w, h);
}

function waveFrame(now) {
  const s = now / 1000;
  // Сдвигаем карту по кругу в пределах одного периода — волны плывут без конца
  waveMap.setAttribute('x', -((s * WAVE_SPEED[0]) % WAVE_PERIOD));
  waveMap.setAttribute('y', -((s * WAVE_SPEED[1]) % WAVE_PERIOD));
  requestAnimationFrame(waveFrame);
}

// Safari плохо поддерживает такие фильтры на странице — там волну не включаем
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

if (!reduceMotion.matches && !isSafari) {
  waveShift.setAttribute('scale', WAVE_SHIFT);
  fitWave();
  new ResizeObserver(fitWave).observe(document.body);
  document.body.style.filter = 'url(#page-wave)';
  requestAnimationFrame(waveFrame);
}
