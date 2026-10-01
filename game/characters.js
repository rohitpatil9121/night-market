import { mat4 } from "../engine/index.js";
import { frameAt, joint } from "./gfx.js";

/**
 * NIGHT MARKET — characters. The engine has no skeletal animation, so a person is a dozen boxes hung
 * on a small hand-built skeleton: hips → torso → head and arms, plus two legs. `drawCharacter` poses the
 * joints from a few numbers (how fast they're walking, what they're doing) and writes the boxes into
 * the character BoxBatch. Looks are data (palette indices), so the simulation can generate and save them.
 * @module game/characters
 */

export const SKIN = [[0.98, 0.82, 0.68], [0.9, 0.7, 0.54], [0.78, 0.58, 0.42], [0.58, 0.4, 0.28], [0.4, 0.27, 0.19]];
export const SHIRT = [
    [0.86, 0.26, 0.28], [0.24, 0.5, 0.88], [0.95, 0.76, 0.24], [0.3, 0.72, 0.5], [0.62, 0.42, 0.86], [0.96, 0.52, 0.2],
    [0.9, 0.92, 0.95], [0.16, 0.17, 0.22], [0.3, 0.32, 0.4], [0.55, 0.12, 0.2], [0.55, 0.85, 0.88], [0.95, 0.56, 0.72],
];
export const PANTS = [[0.14, 0.15, 0.22], [0.2, 0.27, 0.45], [0.36, 0.3, 0.25], [0.5, 0.52, 0.56]];
export const HAIR = [[0.08, 0.07, 0.07], [0.3, 0.19, 0.1], [0.72, 0.5, 0.2], [0.55, 0.55, 0.58], [0.6, 0.16, 0.12]];
const EYE = [0.06, 0.05, 0.08], WHITE = [0.95, 0.95, 0.97], BLACK = [0.07, 0.07, 0.09];
const FOOD = { skewers: [0.85, 0.4, 0.15], dumplings: [0.95, 0.9, 0.78], noodles: [0.98, 0.82, 0.3], tea: [0.75, 0.55, 0.85] };

/** CSS colour for a palette entry, for the DOM portraits on the cards. */
export const css = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

const ROOT = mat4.create(), TORSO = mat4.create(), HEAD = mat4.create(), LIMB = mat4.create(), HAND = mat4.create();

/**
 * @typedef {Object} Pose
 * @property {number} x @property {number} y @property {number} [z]
 * @property {number} yaw           facing, radians (0 = +Y)
 * @property {Object} look          { skin, shirt, pants, hair, hairStyle, h }
 * @property {number} [walk]        0..1, how much of the walk cycle to apply
 * @property {number} [phase]       walk-cycle phase, radians
 * @property {string} [action]      idle | wait | fidget | reach | eat | drink | cheer | storm | serve | counter | tired | argue | wave | show | watch
 * @property {number} [t]           seconds, drives the action's own motion
 * @property {number} [look_at]     head turn, radians
 * @property {string} [prop]        notebook | backpack | tophat | shades | cap | apron
 * @property {number[]} [accent]    colour for the apron band / headband
 * @property {string} [holding]     food type carried in the right hand
 */

/** Write one character into the batch. */
export function drawCharacter(batch, p) {
    const L = p.look, skin = SKIN[L.skin], shirt = SHIRT[L.shirt], pants = PANTS[L.pants], hair = HAIR[L.hair];
    const t = p.t || 0, walk = p.walk || 0, ph = p.phase || 0, act = p.action || "idle";

    // ---- pose numbers
    let lean = 0, bob = 0, armL = 0, armR = 0, spreadL = 0, spreadR = 0, legL = 0, legR = 0, nod = 0, turn = p.look_at || 0;
    const swing = Math.sin(ph) * 0.5 * walk;
    legL = swing; legR = -swing; armL = -swing * 0.9; armR = swing * 0.9;
    bob = Math.abs(Math.sin(ph)) * 0.05 * walk;
    if (act === "idle") { armL += Math.sin(t * 1.4) * 0.05; armR -= Math.sin(t * 1.4) * 0.05; }
    else if (act === "wait") { turn += Math.sin(t * 0.9) * 0.35; armL += 0.05; armR += 0.05; }
    else if (act === "fidget") {                      // patience running out: tapping a foot, looking around
        legR = Math.max(0, Math.sin(t * 9)) * 0.35; turn += Math.sin(t * 3.2) * 0.7; spreadL = 0.35; spreadR = 0.35; armL = 0.5; armR = 0.5; bob = Math.abs(Math.sin(t * 9)) * 0.015;
    } else if (act === "reach") { armR = 1.25 + Math.sin(t * 3) * 0.1; lean = 0.08; }
    else if (act === "eat") { armR = 1.7 + Math.sin(t * 5) * 0.45; armL = 0.5; nod = 0.12 + Math.sin(t * 5) * 0.08; }
    else if (act === "drink") { armR = 2.05 + Math.sin(t * 2.2) * 0.2; nod = -0.1; }
    else if (act === "cheer") { armL = 2.9; armR = 2.9; spreadL = 0.3; spreadR = 0.3; bob += Math.abs(Math.sin(t * 9)) * 0.16; }
    else if (act === "storm") { lean = 0.2; armL *= 1.5; armR *= 1.5; turn += Math.sin(t * 7) * 0.2; }
    else if (act === "serve") { lean = 0.2; armL = 1.15 + Math.sin(t * 13) * 0.35; armR = 1.15 + Math.sin(t * 13 + 3.1) * 0.35; nod = 0.2; }
    else if (act === "counter") { armL = 0.55; armR = 0.55; lean = 0.05; turn += Math.sin(t * 0.6) * 0.5; }
    else if (act === "tired") { lean = 0.38; nod = 0.35; armL = 0.1; armR = 0.1; bob = Math.sin(t * 1.5) * 0.02 - 0.05; }
    else if (act === "argue") { lean = 0.22; armR = 2.1 + Math.sin(t * 17) * 0.45; armL = 0.4; spreadL = 0.5; nod = Math.sin(t * 11) * 0.12; }
    else if (act === "wave") { armR = 2.8; spreadR = 0.35 + Math.sin(t * 9) * 0.35; }
    else if (act === "show") { armL = 2.5; armR = 2.5; spreadL = 0.7 + Math.sin(t * 6) * 0.2; spreadR = 0.7 + Math.sin(t * 6) * 0.2; bob = Math.abs(Math.sin(t * 6)) * 0.06; }
    else if (act === "watch") { armR = 2.2; spreadR = -0.5; nod = 0.08; }

    // ---- skeleton
    const s = L.h || 1;
    frameAt(ROOT, p.x, p.y, (p.z || 0) + bob * s, p.yaw, s);
    joint(TORSO, ROOT, 0, 0, 0.72, lean);
    joint(HEAD, TORSO, 0, 0, 0.66, nod, 0, turn);

    // legs (pivot at the hip)
    joint(LIMB, ROOT, -0.12, 0, 0.72, legL);
    batch.add(LIMB, 0, 0, -0.36, 0.18, 0.2, 0.72, pants[0], pants[1], pants[2]);
    joint(LIMB, ROOT, 0.12, 0, 0.72, legR);
    batch.add(LIMB, 0, 0, -0.36, 0.18, 0.2, 0.72, pants[0], pants[1], pants[2]);

    // torso
    batch.add(TORSO, 0, 0, 0.31, 0.5, 0.28, 0.62, shirt[0], shirt[1], shirt[2]);

    // arms (pivot at the shoulder): sleeve, then a hand
    joint(LIMB, TORSO, -0.315, 0, 0.58, armL, -spreadL);
    batch.add(LIMB, 0, 0, -0.2, 0.13, 0.15, 0.4, shirt[0], shirt[1], shirt[2]);
    batch.add(LIMB, 0, 0, -0.48, 0.12, 0.13, 0.16, skin[0], skin[1], skin[2]);
    joint(HAND, TORSO, 0.315, 0, 0.58, armR, spreadR);
    batch.add(HAND, 0, 0, -0.2, 0.13, 0.15, 0.4, shirt[0], shirt[1], shirt[2]);
    batch.add(HAND, 0, 0, -0.48, 0.12, 0.13, 0.16, skin[0], skin[1], skin[2]);
    if (p.holding) { const f = FOOD[p.holding]; batch.add(HAND, 0, 0.06, -0.62, 0.16, 0.16, p.holding === "tea" ? 0.26 : 0.14, f[0], f[1], f[2], 0.25); }
    if (p.prop === "notebook") { batch.add(HAND, 0, 0.08, -0.6, 0.2, 0.04, 0.26, 0.95, 0.95, 0.9, 0.3); }

    // head, eyes, hair
    batch.add(HEAD, 0, 0, 0.2, 0.4, 0.38, 0.38, skin[0], skin[1], skin[2]);
    batch.add(HEAD, -0.09, 0.19, 0.22, 0.06, 0.03, 0.07, EYE[0], EYE[1], EYE[2]);
    batch.add(HEAD, 0.09, 0.19, 0.22, 0.06, 0.03, 0.07, EYE[0], EYE[1], EYE[2]);
    const hs = L.hairStyle;
    if (p.prop !== "tophat" && p.prop !== "cap") {
        batch.add(HEAD, 0, -0.01, 0.42, 0.44, 0.42, 0.1, hair[0], hair[1], hair[2]);
        if (hs === 1) batch.add(HEAD, 0, 0.17, 0.36, 0.44, 0.08, 0.1, hair[0], hair[1], hair[2]);                 // fringe
        else if (hs === 2) batch.add(HEAD, 0, -0.2, 0.18, 0.44, 0.08, 0.5, hair[0], hair[1], hair[2]);            // long at the back
        else if (hs === 3) batch.add(HEAD, 0, -0.06, 0.53, 0.18, 0.18, 0.14, hair[0], hair[1], hair[2]);          // top knot
    }
    if (hs === 2 && (p.prop === "tophat" || p.prop === "cap")) batch.add(HEAD, 0, -0.2, 0.18, 0.44, 0.08, 0.4, hair[0], hair[1], hair[2]);

    // props that say who this is at a glance
    if (p.prop === "apron") {
        const a = p.accent || WHITE;
        batch.add(TORSO, 0, 0.15, 0.24, 0.42, 0.04, 0.5, WHITE[0], WHITE[1], WHITE[2]);
        batch.add(HEAD, 0, 0, 0.36, 0.46, 0.44, 0.07, a[0], a[1], a[2], 0.35);                                  // headband in the stall's colour
    } else if (p.prop === "backpack") batch.add(TORSO, 0, -0.22, 0.34, 0.4, 0.18, 0.46, 0.92, 0.5, 0.16);
    else if (p.prop === "tophat") {
        batch.add(HEAD, 0, 0, 0.42, 0.56, 0.54, 0.05, BLACK[0], BLACK[1], BLACK[2]);
        batch.add(HEAD, 0, 0, 0.6, 0.36, 0.34, 0.32, BLACK[0], BLACK[1], BLACK[2]);
        batch.add(HEAD, 0, 0, 0.48, 0.37, 0.35, 0.06, 0.75, 0.6, 0.2, 0.3);
    } else if (p.prop === "shades") batch.add(HEAD, 0, 0.2, 0.22, 0.36, 0.03, 0.09, 0.02, 0.02, 0.03);
    else if (p.prop === "cap") {
        batch.add(HEAD, 0, 0, 0.44, 0.44, 0.42, 0.12, WHITE[0], WHITE[1], WHITE[2], 0.2);
        batch.add(HEAD, 0, 0.215, 0.44, 0.1, 0.02, 0.08, 0.9, 0.15, 0.2, 0.5);
    }
}

/** Biscuit: follows Pip, sits and wags when they stop. `sit` 0..1. */
export function drawDog(batch, x, y, yaw, t, walk, sit) {
    const c = [0.85, 0.62, 0.32], d = [0.5, 0.33, 0.16];
    frameAt(ROOT, x, y, 0, yaw, 1);
    const sw = Math.sin(t * 11) * 0.6 * walk, rear = -0.16 * sit;
    joint(TORSO, ROOT, 0, 0, 0.3, -0.45 * sit);
    batch.add(TORSO, 0, 0, 0, 0.24, 0.56, 0.24, c[0], c[1], c[2]);
    joint(HEAD, TORSO, 0, 0.3, 0.14, 0.45 * sit + Math.sin(t * 2.2) * 0.08);
    batch.add(HEAD, 0, 0.08, 0.02, 0.22, 0.24, 0.2, c[0], c[1], c[2]);
    batch.add(HEAD, 0, 0.22, -0.02, 0.1, 0.1, 0.09, d[0], d[1], d[2]);
    batch.add(HEAD, -0.09, 0.02, 0.14, 0.06, 0.08, 0.12, d[0], d[1], d[2]);
    batch.add(HEAD, 0.09, 0.02, 0.14, 0.06, 0.08, 0.12, d[0], d[1], d[2]);
    joint(LIMB, TORSO, 0, -0.28, 0.1, -0.9, 0, Math.sin(t * 16) * 0.7);   // tail
    batch.add(LIMB, 0, -0.1, 0, 0.06, 0.22, 0.06, d[0], d[1], d[2]);
    for (const [lx, ly, k] of [[-0.08, 0.2, 1], [0.08, 0.2, -1], [-0.08, -0.2, -1], [0.08, -0.2, 1]]) {
        joint(LIMB, ROOT, lx, ly, 0.2 + (ly < 0 ? rear : 0), sw * k);
        batch.add(LIMB, 0, 0, -0.1, 0.07, 0.07, 0.2, d[0], d[1], d[2]);
    }
}
