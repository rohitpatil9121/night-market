import { ShaderMaterial, InstancedMesh, Entity, Sky, primitives, projectionChunk, mat4 } from "../engine/index.js";

/**
 * NIGHT MARKET — rendering building blocks that sit on top of the Projection Lab engine.
 *
 * The engine lights everything with one sun and a hemisphere ambient, which can't carry a night street.
 * So the game brings its own material: every surface is lit by up to MAX_LIGHTS coloured point lights
 * (one per stall, lamp and gate), passed as uniform arrays. The street surface uses the same light list,
 * which is what puts a pool of colour on the ground in front of each stall.
 *
 * Everything solid in the game is a box. All boxes go through two InstancedMesh draws (BoxBatch): one for
 * the street furniture, rebuilt only when the layout changes, and one for the characters, rewritten every
 * frame. A unit cube with a per-instance matrix shades correctly even when stretched, because a box's
 * face normals lie along its own axes.
 * @module game/gfx
 */

export const MAX_LIGHTS = 24;

const LIGHTING = /* glsl */ `
uniform vec3 u_camPos;
uniform vec4 u_lightPos[${MAX_LIGHTS}];   // xyz, radius
uniform vec3 u_lightCol[${MAX_LIGHTS}];
uniform float u_lightCount;
uniform vec3 u_ambSky;
uniform vec3 u_ambGround;
uniform vec3 u_moonDir;
uniform vec3 u_moonCol;
uniform vec3 u_fogColor;
uniform float u_fogDensity;

// ambient + moon + every point light. Lights fall to zero at their radius, so far ones cost nothing visually.
vec3 marketLight(vec3 p, vec3 n) {
    vec3 sum = mix(u_ambGround, u_ambSky, n.z * 0.5 + 0.5) + u_moonCol * max(dot(n, u_moonDir), 0.0);
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
        if (float(i) >= u_lightCount) break;
        vec3 d = u_lightPos[i].xyz - p;
        float d2 = dot(d, d), r = u_lightPos[i].w;
        float a = max(0.0, 1.0 - d2 / (r * r));
        float facing = max(dot(n, d * inversesqrt(d2 + 0.0001)), 0.0) * 0.8 + 0.2;   // wrapped, so backs aren't black
        sum += u_lightCol[i] * (a * a * facing);
    }
    return sum;
}
vec3 marketFog(vec3 color, vec3 p) {
    return mix(u_fogColor, color, exp(-length(u_camPos - p) * u_fogDensity));
}
`;

const boxVertex = /* glsl */ `
${projectionChunk}
attribute vec3 a_position;
attribute vec3 a_normal;
attribute mat4 a_instanceMatrix;
attribute vec4 a_instanceColor;     // rgb, and how emissive (0 = lit by the street, 1 = glows by itself)
uniform mat4 u_model;
varying vec3 v_world;
varying vec3 v_normal;
varying vec4 v_color;
void main() {
    mat4 model = u_model * a_instanceMatrix;
    vec4 world = model * vec4(a_position, 1.0);
    v_world = world.xyz;
    v_normal = (model * vec4(a_normal, 0.0)).xyz;
    v_color = a_instanceColor;
    gl_Position = projectLab(world.xyz);
}
`;

const boxFragment = /* glsl */ `
${LIGHTING}
varying vec3 v_world;
varying vec3 v_normal;
varying vec4 v_color;
void main() {
    vec3 lit = v_color.rgb * marketLight(v_world, normalize(v_normal));
    vec3 color = mix(marketFog(lit, v_world), v_color.rgb, v_color.a);
    gl_FragColor = vec4(color, 1.0);
}
`;

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
${LIGHTING}
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
    float paved = step(-8.6, p.y) * step(p.y, 1.75) * step(u_street.x, p.x) * step(p.x, u_street.y);
    float plots = step(1.75, p.y) * step(p.y, 5.2);
    vec2 tile = floor(p / 1.2);
    float grain = hash21(tile) * 0.35 + hash21(floor(p * 9.0)) * 0.12;
    vec3 slab = vec3(0.34, 0.33, 0.37) * (0.78 + grain);
    slab *= 1.0 - 0.55 * max(lineMask(p.x, 1.2, 0.05), lineMask(p.y, 1.2, 0.05));
    vec3 asphalt = vec3(0.12, 0.12, 0.145) * (0.85 + hash21(floor(p * 6.0)) * 0.3);
    // a dashed centre line on the road
    float dash = step(0.5, fract(p.x / 3.0)) * (1.0 - smoothstep(0.06, 0.1, abs(p.y + 11.6))) * step(p.y, -8.6);
    asphalt = mix(asphalt, vec3(0.6, 0.55, 0.3), dash * 0.7);
    vec3 concrete = vec3(0.2, 0.2, 0.23) * (0.85 + grain * 0.5);
    vec3 albedo = mix(asphalt, slab, paved);
    albedo = mix(albedo, concrete, plots);
    // kerb line between walkway and road
    albedo = mix(albedo, vec3(0.5, 0.5, 0.55), (1.0 - smoothstep(0.05, 0.12, abs(p.y + 8.6))) * step(u_street.x, p.x) * step(p.x, u_street.y));

    vec3 light = marketLight(v_world, vec3(0.0, 0.0, 1.0));
    // the street is a little wet: light pools pick up a sheen where the surface is smooth
    float wet = 0.35 + 0.65 * hash21(floor(p * 2.5));
    vec3 color = albedo * light + light * light * (0.05 * wet);
    gl_FragColor = vec4(marketFog(color, v_world), 1.0);
}
`;

/** Night sky over the city: a dark dome, a glow where the horizon is, stars and a moon. */
const skyFragment = /* glsl */ `
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
uniform vec4 u_proj;
uniform float u_time;
uniform vec3 u_fogColor;
varying vec2 v_ndc;

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

void main() {
    vec3 ray = normalize(u_camForward + u_camRight * (v_ndc.x / u_proj.x) + u_camUp * (v_ndc.y / u_proj.y));
    float h = ray.z;
    vec3 zenith = vec3(0.008, 0.012, 0.04);
    vec3 glow = vec3(0.2, 0.07, 0.2);
    vec3 col = mix(glow, zenith, smoothstep(-0.02, 0.5, h));
    col += vec3(0.32, 0.14, 0.06) * exp(-abs(h) * 11.0) * 0.5;
    // stars, only well above the city glow
    vec3 cell = floor(ray * 90.0);
    float star = step(0.985, hash13(cell)) * smoothstep(0.08, 0.35, h);
    col += vec3(0.8, 0.85, 1.0) * star * (0.5 + 0.5 * sin(u_time * (1.0 + hash13(cell + 7.0) * 3.0)));
    // moon
    float m = dot(ray, normalize(vec3(-0.35, 0.7, 0.42)));
    col += vec3(1.5, 1.45, 1.25) * smoothstep(0.9988, 0.9992, m) + vec3(0.2, 0.22, 0.3) * pow(max(m, 0.0), 220.0);
    // below the horizon the ground has faded into fog
    col = mix(u_fogColor, col, smoothstep(-0.06, 0.02, h));
    gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * The shared light list and the materials that read it. Edit `lights` through setLight()/count and
 * every material sees the change, because they all hold the same typed arrays.
 */
export function createLighting() {
    const uniforms = {
        u_lightPos: new Float32Array(MAX_LIGHTS * 4),
        u_lightCol: new Float32Array(MAX_LIGHTS * 3),
        u_lightCount: 0,
        u_ambSky: new Float32Array([0.105, 0.115, 0.21]),
        u_ambGround: new Float32Array([0.04, 0.035, 0.06]),
        u_moonDir: new Float32Array([-0.33, -0.5, 0.8]),
        u_moonCol: new Float32Array([0.11, 0.13, 0.2]),
        u_fogColor: new Float32Array([0.028, 0.024, 0.06]),
        u_fogDensity: 0.0065,
        u_street: new Float32Array([-4, 20]),
    };
    const boxMaterial = new ShaderMaterial({ name: "market-box", vertex: boxVertex, fragment: boxFragment, uniforms });
    const groundMaterial = new ShaderMaterial({ name: "market-ground", vertex: groundVertex, fragment: groundFragment, uniforms });
    const sky = new Sky({ name: "market-sky", fragment: skyFragment, uniforms: { u_fogColor: uniforms.u_fogColor } });
    return {
        uniforms, boxMaterial, groundMaterial, sky,
        /** Write light i. Colours may exceed 1; radius is where the light reaches zero. */
        setLight(i, x, y, z, radius, r, g, b) {
            const p = uniforms.u_lightPos, c = uniforms.u_lightCol;
            p[i * 4] = x; p[i * 4 + 1] = y; p[i * 4 + 2] = z; p[i * 4 + 3] = radius;
            c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
        },
        setCount(n) { uniforms.u_lightCount = Math.min(n, MAX_LIGHTS); },
    };
}

const UNIT_BOX = primitives.box(1, 1, 1);

/**
 * A pile of boxes drawn in one call. Usage per rebuild: begin(), add(...) many times, end().
 * `frame` is a column-major mat4 giving the space the box is described in (see frames below).
 */
export class BoxBatch {
    constructor(material, capacity, name) {
        this.mesh = new InstancedMesh(UNIT_BOX, material, capacity);
        this.mesh.count = 0;
        this.entity = new Entity({ name, mesh: this.mesh });
        this.entity.interpolate = false;
        this.capacity = capacity;
        this.n = 0;
        this._last = 0;
    }

    begin() { this.n = 0; }

    /** Box of size (sx, sy, sz) centred at (cx, cy, cz) in `frame`. e: 0 lit … 1 fully self-lit. */
    add(frame, cx, cy, cz, sx, sy, sz, r, g, b, e = 0) {
        if (this.n >= this.capacity) return;
        const m = this.mesh.matrices, o = this.n * 16, F = frame;
        m[o] = F[0] * sx; m[o + 1] = F[1] * sx; m[o + 2] = F[2] * sx; m[o + 3] = 0;
        m[o + 4] = F[4] * sy; m[o + 5] = F[5] * sy; m[o + 6] = F[6] * sy; m[o + 7] = 0;
        m[o + 8] = F[8] * sz; m[o + 9] = F[9] * sz; m[o + 10] = F[10] * sz; m[o + 11] = 0;
        m[o + 12] = F[0] * cx + F[4] * cy + F[8] * cz + F[12];
        m[o + 13] = F[1] * cx + F[5] * cy + F[9] * cz + F[13];
        m[o + 14] = F[2] * cx + F[6] * cy + F[10] * cz + F[14];
        m[o + 15] = 1;
        const c = this.mesh.colors, k = this.n * 4;
        c[k] = r; c[k + 1] = g; c[k + 2] = b; c[k + 3] = e;
        this.n++;
    }

    end() {
        const top = Math.max(this.n, this._last);
        this.mesh.count = this.n;
        if (top > 0) { this.mesh.markDirty(0); this.mesh.markDirty(top - 1); }
        this._last = this.n;
    }
}

// ------------------------------------------------------------------ frames (no allocation)
const V = new Float32Array(3);
export const IDENTITY = mat4.create();

/** out = translate(x, y, z) · rotateZ(yaw) · scale(s) */
export function frameAt(out, x, y, z, yaw = 0, s = 1) {
    const c = Math.cos(yaw) * s, n = Math.sin(yaw) * s;
    out[0] = c; out[1] = n; out[2] = 0; out[3] = 0;
    out[4] = -n; out[5] = c; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = s; out[11] = 0;
    out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
    return out;
}

/** out = parent · translate(px, py, pz) · rotateZ(rz) · rotateY(ry) · rotateX(rx): a joint. */
export function joint(out, parent, px, py, pz, rx = 0, ry = 0, rz = 0) {
    V[0] = px; V[1] = py; V[2] = pz;
    mat4.translate(out, parent, V);
    if (rz) mat4.rotateZ(out, out, rz);
    if (ry) mat4.rotateY(out, out, ry);
    if (rx) mat4.rotateX(out, out, rx);
    return out;
}
