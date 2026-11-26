/**
 * Shaders for the work plates, written twice: WGSL for WebGPU, GLSL ES 3.0 for WebGL2.
 * Both read the same 16-float uniform block per plate:
 *
 *   rect  = (x, y, width, height)            in CSS pixels, top-left origin
 *   view  = (viewportW, viewportH, bend, reveal)
 *   ptr   = (pointerU, pointerV, strength, unused)
 *   misc  = (coverX, coverY, zoom, parallax)
 *
 * What the effect does, and why:
 * - reveal: the plate unfolds from the bottom with a soft arc, while the image
 *   settles from a slight zoom. Finished work arrives like a print being laid down.
 * - bend: scroll velocity bows the plate like a sheet of paper dragged through air,
 *   so the work feels physical without moving the layout.
 * - parallax: the image drifts inside its frame as it crosses the viewport.
 * - pointer: a gentle loupe follows a mouse over the work (skipped in lite mode).
 */

export function wgsl(lite) {
  return /* wgsl */ `
struct U {
  rect: vec4f,
  view: vec4f,
  ptr: vec4f,
  misc: vec4f,
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

const PI: f32 = 3.14159265;
const LITE: bool = ${lite ? 'true' : 'false'};

@vertex
fn vs(@location(0) uv: vec2f) -> VOut {
  var p = u.rect.xy + uv * u.rect.zw;
  p.y = p.y + sin(uv.x * PI) * u.view.z;
  var o: VOut;
  o.pos = vec4f(p.x / u.view.x * 2.0 - 1.0, 1.0 - p.y / u.view.y * 2.0, 0.0, 1.0);
  o.uv = uv;
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let uv = i.uv;
  let reveal = u.view.w;
  let r = 1.0 - reveal;
  let ease = 1.0 - r * r * r;

  // Arc-shaped wipe from the bottom edge.
  let edge = 1.0 - reveal * 1.35 + 0.3 * (1.0 - sin(uv.x * PI));
  let mask = smoothstep(edge, edge + 0.05, uv.y);

  // Cover-fit, zoom that settles as the plate reveals, and parallax drift.
  let zoom = u.misc.z * (1.0 + 0.14 * (1.0 - ease));
  var iuv = (uv - vec2f(0.5)) * u.misc.xy / zoom + vec2f(0.5);
  iuv.y = iuv.y + u.misc.w;

  // A touch of vertical stretch while the page is moving fast.
  let stretch = clamp(abs(u.view.z) * 0.0011, 0.0, 0.05);
  iuv.y = (iuv.y - 0.5) * (1.0 - stretch) + 0.5;

  if (!LITE) {
    var d = uv - u.ptr.xy;
    d.x = d.x * (u.rect.z / u.rect.w);
    let f = u.ptr.z * exp(-dot(d, d) * 9.0);
    iuv = iuv - (uv - u.ptr.xy) * 0.06 * f;
  }

  let c = textureSample(tex, samp, clamp(iuv, vec2f(0.0), vec2f(1.0)));

  // Slight shade just behind the wipe gives the reveal some weight.
  let shade = 1.0 - (1.0 - smoothstep(edge, edge + 0.3, uv.y)) * 0.22 * (1.0 - ease);
  return vec4f(c.rgb * shade * mask, mask);
}
`;
}

export function glsl(lite) {
  const head = `#version 300 es
precision highp float;
#define PI 3.14159265
#define LITE ${lite ? 1 : 0}
uniform vec4 u[4];
`;

  const vert = `${head}
layout(location = 0) in vec2 aUv;
out vec2 vUv;
void main() {
  vec4 rect = u[0];
  vec4 view = u[1];
  vec2 p = rect.xy + aUv * rect.zw;
  p.y += sin(aUv.x * PI) * view.z;
  gl_Position = vec4(p.x / view.x * 2.0 - 1.0, 1.0 - p.y / view.y * 2.0, 0.0, 1.0);
  vUv = aUv;
}`;

  const frag = `${head}
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 rect = u[0];
  vec4 view = u[1];
  vec4 ptr = u[2];
  vec4 misc = u[3];
  vec2 uv = vUv;
  float reveal = view.w;
  float r = 1.0 - reveal;
  float ease = 1.0 - r * r * r;

  float edge = 1.0 - reveal * 1.35 + 0.3 * (1.0 - sin(uv.x * PI));
  float mask = smoothstep(edge, edge + 0.05, uv.y);

  float zoom = misc.z * (1.0 + 0.14 * (1.0 - ease));
  vec2 iuv = (uv - 0.5) * misc.xy / zoom + 0.5;
  iuv.y += misc.w;

  float stretch = clamp(abs(view.z) * 0.0011, 0.0, 0.05);
  iuv.y = (iuv.y - 0.5) * (1.0 - stretch) + 0.5;

#if LITE == 0
  vec2 d = uv - ptr.xy;
  d.x *= rect.z / rect.w;
  float f = ptr.z * exp(-dot(d, d) * 9.0);
  iuv -= (uv - ptr.xy) * 0.06 * f;
#endif

  vec3 c = texture(uTex, clamp(iuv, 0.0, 1.0)).rgb;
  float shade = 1.0 - (1.0 - smoothstep(edge, edge + 0.3, uv.y)) * 0.22 * (1.0 - ease);
  outColor = vec4(c * shade * mask, mask);
}`;

  return { vert, frag };
}

/** A strip of quads: subdivided across x (for the bend), one row tall. */
export function buildMesh(segments) {
  const cols = segments + 1;
  const verts = new Float32Array(cols * 2 * 2);
  for (let x = 0; x < cols; x++) {
    const u = x / segments;
    verts.set([u, 0], x * 4);
    verts.set([u, 1], x * 4 + 2);
  }
  const idx = new Uint16Array(segments * 6);
  for (let x = 0; x < segments; x++) {
    const a = x * 2;
    idx.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], x * 6);
  }
  return { verts, idx };
}
