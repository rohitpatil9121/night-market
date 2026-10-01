import { ShaderMaterial, Sky, Texture, projectionChunk, lightingChunk } from "../engine/index.js";
import { STALLS } from "./data.js";

/**
 * NIGHT MARKET — the game's own shaders and textures, on top of the engine's light system.
 *
 *   createGroundMaterial()  the street: paving, plots and road, lit by the engine's lighting chunk, so it
 *                           receives the sun's shadows and a pool of colour from every stall
 *   createSky()             an evening sky that darkens from sunset to night
 *   signTexture(type)       a stall's sign, drawn on a 2D canvas
 * @module game/gfx
 */

const groundVertex = /* glsl */ `
${projectionChunk}
attribute vec3 a_position;
uniform mat4 u_model;
varying vec3 v_world;
void main() {
    vec4 world = u_model * vec4(a_position, 1.0);
    v_world = world.xyz;
    gl_Position = projectLab(world.xyz);
}
`;

const groundFragment = /* glsl */ `
${lightingChunk}
uniform vec2 u_street;      // x of the left and right ends of the paved walkway
varying vec3 v_world;

float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float lineMask(float coord, float spacing, float width) {
    float d = abs(fract(coord / spacing + 0.5) - 0.5) * spacing;
    return 1.0 - smoothstep(width * 0.5, width, d);
}

void main() {
    vec2 p = v_world.xy;
    // three surfaces: the stall plots at the back, the paved walkway, and the road in front
    float inStreet = step(u_street.x, p.x) * step(p.x, u_street.y);
    float paved = step(-8.6, p.y) * step(p.y, 1.75) * inStreet;
    float plots = step(1.75, p.y) * step(p.y, 5.2);
    vec2 tile = floor(p / 1.2);
    float tone = hash21(tile);
    // warm stone slabs in three shades, with dark joints
    vec3 slab = mix(vec3(0.66, 0.6, 0.55), vec3(0.76, 0.7, 0.62), tone) * (0.94 + hash21(floor(p * 7.0)) * 0.1);
    slab *= 1.0 - 0.4 * max(lineMask(p.x, 1.2, 0.045), lineMask(p.y, 1.2, 0.045));
    vec3 asphalt = vec3(0.25, 0.25, 0.3) * (0.9 + hash21(floor(p * 6.0)) * 0.2);
    float dash = step(0.5, fract(p.x / 3.0)) * (1.0 - smoothstep(0.06, 0.1, abs(p.y + 11.6))) * step(p.y, -8.6);
    asphalt = mix(asphalt, vec3(0.95, 0.85, 0.5), dash * 0.8);
    vec3 concrete = vec3(0.5, 0.49, 0.5) * (0.92 + tone * 0.12);
    vec3 albedo = mix(asphalt, slab, paved);
    albedo = mix(albedo, concrete, plots);
    // kerb between walkway and road
    albedo = mix(albedo, vec3(0.82, 0.8, 0.78), (1.0 - smoothstep(0.06, 0.13, abs(p.y + 8.6))) * inStreet);

    vec3 n = vec3(0.0, 0.0, 1.0);
    vec3 lamps = labPoints(v_world, n);
    // the street is a little damp: coloured light leaves a sheen on the smoother slabs
    vec3 color = albedo * (labAmbient(n) + labSun(v_world, n) + lamps) + lamps * lamps * (0.03 + 0.05 * tone);
    gl_FragColor = vec4(labFog(color, v_world), 1.0);
}
`;

export function createGroundMaterial() {
    return new ShaderMaterial({ name: "market-ground", vertex: groundVertex, fragment: groundFragment, castShadow: false, uniforms: { u_street: new Float32Array([-40, 60]) } });
}

const skyFragment = /* glsl */ `
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
uniform vec4 u_proj;
uniform float u_time;
uniform float u_dusk;       // 0 = sunset, 1 = night
uniform vec3 u_haze;        // the colour the ground fades to (the scene's fog colour)
varying vec2 v_ndc;

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

void main() {
    vec3 ray = normalize(u_camForward + u_camRight * (v_ndc.x / u_proj.x) + u_camUp * (v_ndc.y / u_proj.y));
    float h = ray.z;
    vec3 zenith = mix(vec3(0.2, 0.26, 0.56), vec3(0.008, 0.012, 0.04), u_dusk);
    vec3 horizon = mix(vec3(1.05, 0.56, 0.3), vec3(0.2, 0.07, 0.2), u_dusk);
    vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.5, h));
    col += mix(vec3(0.6, 0.25, 0.1), vec3(0.32, 0.14, 0.06), u_dusk) * exp(-abs(h) * 9.0) * 0.5;
    // stars come out as it darkens
    vec3 cell = floor(ray * 90.0);
    float star = step(0.985, hash13(cell)) * smoothstep(0.08, 0.35, h) * smoothstep(0.35, 0.9, u_dusk);
    col += vec3(0.8, 0.85, 1.0) * star * (0.5 + 0.5 * sin(u_time * (1.0 + hash13(cell + 7.0) * 3.0)));
    float m = dot(ray, normalize(vec3(-0.35, 0.7, 0.42)));
    col += (vec3(1.5, 1.45, 1.25) * smoothstep(0.9988, 0.9992, m) + vec3(0.2, 0.22, 0.3) * pow(max(m, 0.0), 220.0)) * smoothstep(0.2, 0.8, u_dusk);
    col = mix(u_haze, col, smoothstep(-0.06, 0.02, h));
    gl_FragColor = vec4(col, 1.0);
}
`;

/** The sky. Set `sky.uniforms.u_dusk` (0 sunset … 1 night) and copy the fog colour into `u_haze`. */
export function createSky() {
    return new Sky({ name: "market-sky", fragment: skyFragment, uniforms: { u_dusk: 0, u_haze: [0.5, 0.4, 0.42] } });
}

const signs = new Map();
const NAMES = { skewers: "SKEWERS", dumplings: "DUMPLINGS", noodles: "NOODLES", tea: "BUBBLE TEA", rival: "FINCH'S" };
const ICONS = { skewers: "🍢", dumplings: "🥟", noodles: "🍜", tea: "🧋", rival: "🕶" };
const css = (c, k = 1) => `rgb(${Math.round(Math.min(1, c[0] * k) * 255)},${Math.round(Math.min(1, c[1] * k) * 255)},${Math.round(Math.min(1, c[2] * k) * 255)})`;

/** A stall's sign face: its icon and name on the stall's colour. One texture per stall type, made once. */
export function signTexture(type) {
    if (signs.has(type)) return signs.get(type);
    const c = type === "rival" ? [0.9, 0.12, 0.12] : STALLS[type].color;
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 160;
    const g = canvas.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 160);
    grad.addColorStop(0, css(c, 1.15)); grad.addColorStop(1, css(c, 0.8));
    g.fillStyle = grad; g.fillRect(0, 0, 512, 160);
    g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 8; g.strokeRect(10, 10, 492, 140);
    g.textBaseline = "middle";
    g.font = "92px serif"; g.textAlign = "left";
    g.fillText(ICONS[type], 30, 86);
    const name = NAMES[type];
    g.font = `800 ${name.length > 8 ? 58 : 68}px "Space Grotesk", system-ui, sans-serif`;
    g.textAlign = "center";
    g.lineJoin = "round"; g.lineWidth = 10; g.strokeStyle = "rgba(40,10,20,0.55)"; g.strokeText(name, 320, 84);
    g.fillStyle = "#fffdf2"; g.fillText(name, 320, 84);
    const texture = new Texture({ source: canvas, flipY: true, wrap: "clamp", name: "sign-" + type });
    signs.set(type, texture);
    return texture;
}
