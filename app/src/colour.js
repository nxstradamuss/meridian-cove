// Colour arithmetic for the cover.
//
// The grades are written in plain CSS colours, because that is the easiest way to read a recipe. These helpers let
// the renderer move those colours round the hue wheel, scale them, mix them, and read a hue back out of them — so
// one grade can be worn at several temperatures without being rewritten, and the key grade can be matched to the
// hue a photograph already has.

function clampByte(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(255, Math.max(0, Math.round(number)));
}

function clampUnit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(1, Math.max(0, number));
}

/** Parses `#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)` into { r, g, b, a }. */
export function parseColour(value) {
  if (value && typeof value === 'object') {
    return {
      r: clampByte(value.r),
      g: clampByte(value.g),
      b: clampByte(value.b),
      a: clampUnit(value.a ?? 1),
    };
  }

  const text = String(value ?? '').trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1].length === 3
      ? hex[1].split('').map((digit) => digit + digit).join('')
      : hex[1];
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }

  const call = /^rgba?\(([^)]*)\)$/i.exec(text);
  if (call) {
    const parts = call[1].split(',').map((piece) => Number.parseFloat(piece));
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return {
        r: clampByte(parts[0]),
        g: clampByte(parts[1]),
        b: clampByte(parts[2]),
        a: clampUnit(parts.length > 3 ? parts[3] : 1),
      };
    }
  }

  // Anything unreadable becomes white: a grade must never paint a hole.
  return { r: 255, g: 255, b: 255, a: 1 };
}

/** Formats { r, g, b, a } back into an `rgba(...)` string. */
export function formatColour(colour) {
  const alpha = Math.round(clampUnit(colour?.a ?? 1) * 1000) / 1000;
  return `rgba(${clampByte(colour?.r)},${clampByte(colour?.g)},${clampByte(colour?.b)},${alpha})`;
}

/** The same colour at another alpha. */
export function setAlpha(value, alpha) {
  const colour = parseColour(value);
  return formatColour({ r: colour.r, g: colour.g, b: colour.b, a: alpha });
}

/** RGB (0..255) to HSL, with h in 0..1 and s, l in 0..1. */
export function rgbToHsl(r, g, b) {
  const red = clampByte(r) / 255;
  const green = clampByte(g) / 255;
  const blue = clampByte(b) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const l = (max + min) / 2;
  if (!delta) return { h: 0, s: 0, l };
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h;
  if (max === red) h = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
  else if (max === green) h = ((blue - red) / delta + 2) / 6;
  else h = ((red - green) / delta + 4) / 6;
  return { h, s, l };
}

/** HSL (h in 0..1) back to RGB in 0..255. */
export function hslToRgb(h, s, l) {
  const hue = ((Number(h) % 1) + 1) % 1;
  const sat = clampUnit(s);
  const light = clampUnit(l);
  if (!sat) {
    const grey = light * 255;
    return { r: grey, g: grey, b: grey };
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t) => {
    let offset = t;
    if (offset < 0) offset += 1;
    if (offset > 1) offset -= 1;
    if (offset < 1 / 6) return p + (q - p) * 6 * offset;
    if (offset < 1 / 2) return q;
    if (offset < 2 / 3) return p + (q - p) * (2 / 3 - offset) * 6;
    return p;
  };
  return {
    r: channel(hue + 1 / 3) * 255,
    g: channel(hue) * 255,
    b: channel(hue - 1 / 3) * 255,
  };
}

/** The hue of an RGB triple, in degrees 0..360. */
export function hueOfRgb(r, g, b) {
  return rgbToHsl(r, g, b).h * 360;
}

/** The hue of a CSS colour, in degrees 0..360. */
export function hueOfColour(value) {
  const { r, g, b } = parseColour(value);
  return hueOfRgb(r, g, b);
}

/** Moves a colour round the hue wheel, keeping its saturation, lightness and alpha. */
export function rotateColour(value, degrees) {
  const { r, g, b, a } = parseColour(value);
  const hsl = rgbToHsl(r, g, b);
  if (!hsl.s) return { r, g, b, a };
  const turned = hslToRgb((((hsl.h * 360 + Number(degrees)) % 360) + 360) % 360 / 360, hsl.s, hsl.l);
  return { ...turned, a };
}

/** Mixes two colours, `t` of the way from the first to the second. */
export function mixColours(first, second, t) {
  const a = parseColour(first);
  const b = parseColour(second);
  const amount = clampUnit(t);
  return formatColour({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
    a: a.a + (b.a - a.a) * amount,
  });
}

/** How far apart two hues are, the short way round the wheel, in degrees 0..180. */
export function hueGap(first, second) {
  const raw = Math.abs(((Number(first) - Number(second)) % 360 + 360) % 360);
  return raw > 180 ? 360 - raw : raw;
}
