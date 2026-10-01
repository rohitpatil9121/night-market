import { Entity, Mesh, BasicMaterial, ParticleSystem, primitives, mat4 } from "../engine/index.js";
import { STREET, STALLS } from "./data.js";
import { slotX, streetEnds, stallAt, worker, vendorById, hiredVendors, neighbours, relation } from "./sim.js";
import { createLighting, BoxBatch, frameAt, IDENTITY, MAX_LIGHTS } from "./gfx.js";
import { drawCharacter, drawDog } from "./characters.js";

/**
 * NIGHT MARKET — the 3D scene. Pure presentation: it reads the simulation state and draws it, and never
 * changes it. Two instanced box batches do nearly all the work:
 *   statics  street furniture, stalls, buildings. Rebuilt by rebuild() when the layout changes.
 *   chars    every vendor and customer. Rewritten each rendered frame by frame().
 * so a full street is a handful of draw calls however many people are on it.
 * @module game/world
 */

const TAU = Math.PI * 2;
/** cheap repeatable noise for decoration (never for gameplay) */
const noise = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const WOOD = [0.36, 0.25, 0.17], TOP = [0.62, 0.5, 0.37], METAL = [0.2, 0.2, 0.25], DARK = [0.13, 0.13, 0.17];
const WARM = [2.3, 1.75, 0.95];
const F = mat4.create();
const PROPS = { critic: "notebook", student: "backpack", landlord: "tophat", rival: "shades", nurse: "cap" };

export class World {
    /** @param {import("../engine/index.js").Game} game */
    constructor(game) {
        this.game = game;
        this.reducedMotion = false;
        this.light = createLighting();
        game.scene.sky = this.light.sky;
        this.root = game.scene.add(new Entity({ name: "world" }));

        this.ground = this.root.add(new Entity({ name: "ground", mesh: new Mesh(primitives.plane(260, 110), this.light.groundMaterial) }));
        this.ground.setPosition(14, -4, 0);
        this.statics = new BoxBatch(this.light.boxMaterial, 5200, "statics");
        this.chars = new BoxBatch(this.light.boxMaterial, 2600, "chars");
        this.root.add(this.statics.entity);
        this.root.add(this.chars.entity);

        // slot markers: one glowing tile per possible slot, shown while placing or moving a stall
        const tile = primitives.plane(2.6, 2.5);
        this.slotTiles = [];
        for (let i = 0; i < STREET.maxSlots; i++) {
            const e = this.root.add(new Entity({ name: "slot" + i, visible: false,
                mesh: new Mesh(tile, new BasicMaterial({ lit: false, color: [0.3, 1.2, 0.7], opacity: 0.35, blending: "additive", depthWrite: false, cull: "none" })) }));
            e.setPosition(slotX(i), STREET.stallY + 0.05, 0.06);
            this.slotTiles.push(e);
        }
        this.slotMode = null;

        // selection ring
        this.ring = this.root.add(new Entity({ name: "ring", visible: false,
            mesh: new Mesh(primitives.torus(1, 0.05, 6, 40), new BasicMaterial({ lit: false, color: [1.6, 2.4, 2.6] })) }));
        this.selected = null;

        this.steam = this.root.add(new ParticleSystem({ name: "steam", capacity: 900, gravity: [0, 0, 0.9], drag: 0.7, blending: "normal" }));
        this.sparks = this.root.add(new ParticleSystem({ name: "sparks", capacity: 1600, gravity: [0, 0, -7], drag: 0.5 }));
        for (const e of [this.ground, this.ring, ...this.slotTiles]) e.interpolate = false;

        /** render-side memory per character: smoothed facing, walk phase, short-lived reactions */
        this.memo = new Map();
        /** where things are on screen-relevant anchors: key ("c12", "v3", "s7") → [x, y, z] */
        this.anchors = new Map();
        this.lights = [];
        this.steamClock = 0;
        this.state = null;
    }

    // ------------------------------------------------------------------ static scene
    /** Rebuild the street for this state. Call after anything that changes the layout. */
    rebuild(s) {
        this.state = s;
        const B = this.statics, L = [];
        for (const k of [...this.anchors.keys()]) if (k[0] === "s") this.anchors.delete(k);
        const ends = streetEnds(s), gateL = -2.5, gateR = slotX(s.slots - 1) + 2.5;
        this.light.uniforms.u_street[0] = ends.left - 30;
        this.light.uniforms.u_street[1] = ends.right + 30;
        B.begin();

        // low wall behind the stalls
        B.add(IDENTITY, (gateL + gateR) / 2, 5.25, 0.7, gateR - gateL + 16, 0.2, 1.4, 0.15, 0.14, 0.19);

        // gates at both ends
        for (const [gx, hue] of [[gateL, [2.3, 0.45, 1.5]], [gateR, [0.5, 1.7, 2.3]]]) {
            for (const gy of [-8.35, 1.75]) B.add(IDENTITY, gx, gy, 2.15, 0.26, 0.26, 4.3, 0.5, 0.13, 0.15);
            B.add(IDENTITY, gx, -3.3, 4.35, 0.34, 10.6, 0.3, 0.5, 0.13, 0.15);
            B.add(IDENTITY, gx, -3.3, 4.62, 0.5, 11.2, 0.14, 0.34, 0.09, 0.11);
            B.add(IDENTITY, gx, -3.3, 4.12, 0.1, 9.8, 0.08, hue[0], hue[1], hue[2], 1);
            for (let k = 0; k < 5; k++) B.add(IDENTITY, gx, -7 + k * 1.85, 3.78, 0.22, 0.22, 0.3, 2.1, 0.5 + (k % 2) * 0.9, 0.3, 1);
            L.push({ x: gx, y: -3.3, z: 3.4, r: 7.5, c: [hue[0] * 0.38, hue[1] * 0.38, hue[2] * 0.38] });
        }

        // slots and stalls
        for (let slot = 0; slot < s.slots; slot++) {
            const x = slotX(slot), stall = stallAt(s, slot);
            if (!stall) { this._plot(B, x); continue; }
            const def = STALLS[stall.type], v = stall.vendorId != null ? vendorById(s, stall.vendorId) : null, open = !!(v && v.hired && !v.off);
            this._stall(B, x, stall.type, stall.level, open, def.color);
            this.anchors.set("s" + stall.id, [x, 2.5, 4.05 + (stall.level === 3 ? 0.45 : 0)]);
            if (open) L.push({ x, y: 1.35, z: 2.35, r: 6.2 + stall.level * 0.6, c: [def.color[0] * 1.25, def.color[1] * 1.25, def.color[2] * 1.25], stall: stall.id });
        }

        // the competing stall Finch opens at the end of the street
        if (s.rivalStall) {
            const x = gateR + 3.4;
            this._stall(B, x, "rival", 1, true, [1.0, 0.12, 0.12]);
            L.push({ x, y: 1.35, z: 2.35, r: 5.5, c: [0.9, 0.12, 0.1] });
        }

        // eating area: standing tables, and lamps along the kerb
        for (let x = gateL + 2.2, i = 0; x < gateR - 1.5; x += 3.3, i++) {
            const y = -6.35 + (i % 2) * 0.5;
            B.add(IDENTITY, x, y, 0.5, 0.12, 0.12, 1.0, METAL[0], METAL[1], METAL[2]);
            B.add(IDENTITY, x, y, 1.03, 0.95, 0.95, 0.07, TOP[0], TOP[1], TOP[2]);
            B.add(IDENTITY, x, y, 1.13, 0.09, 0.09, 0.12, 2.2, 1.5, 0.5, 1);
        }
        const span = gateR - gateL, lamps = Math.max(2, Math.round(span / 7.5));
        for (let i = 0; i < lamps; i++) {
            const x = gateL + (span * (i + 0.5)) / lamps;
            // low bollard lights: tall posts here would stand between the camera and the street
            B.add(IDENTITY, x, -8.3, 0.45, 0.2, 0.2, 0.9, METAL[0], METAL[1], METAL[2]);
            B.add(IDENTITY, x, -8.3, 0.98, 0.3, 0.3, 0.16, WARM[0], WARM[1], WARM[2], 1);
            L.push({ x, y: -6.9, z: 3.0, r: 9, c: [0.82, 0.6, 0.36] });
        }

        // a string of lanterns from gate to gate, sagging between the stalls, high enough to clear the signs
        const count = Math.round(span / 0.75);
        for (let k = 1; k < count; k++) {
            const u = k / count, x = gateL + u * span, sag = Math.abs(Math.sin(u * Math.PI * Math.max(1, Math.round(span / 6))));
            const red = k % 2 === 0;
            B.add(IDENTITY, x, 1.7, 4.75 - sag * 0.45, 0.18, 0.18, 0.24, 1.9, red ? 0.4 : 1.35, red ? 0.25 : 0.35, 1);
        }

        // the city behind: dark blocks with lit windows and a few neon signs
        let cursor = gateL - 24, i = 0;
        while (cursor < gateR + 24) {
            const w = 4.5 + noise(i) * 4, h = 7 + noise(i + 50) * 10, shade = 0.07 + noise(i + 90) * 0.04;
            const cx = cursor + w / 2;
            B.add(IDENTITY, cx, 10.5, h / 2, w - 0.3, 8, h, shade, shade, shade * 1.5);
            const cols = Math.floor((w - 1) / 1.15), rows = Math.floor((h - 2.4) / 1.55);
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                const n = noise(i * 131 + r * 17 + c * 7.3);
                if (n > 0.42) continue;
                const tint = n < 0.14 ? [0.55, 0.85, 1.25] : n < 0.2 ? [1.25, 0.5, 0.95] : [1.3, 0.95, 0.5], k = 0.55 + noise(i + r * 3 + c) * 0.5;
                B.add(IDENTITY, cx - ((cols - 1) * 1.15) / 2 + c * 1.15, 6.47, 2.6 + r * 1.55, 0.55, 0.06, 0.8, tint[0] * k, tint[1] * k, tint[2] * k, 1);
            }
            if (noise(i + 7) > 0.55) {
                const col = noise(i + 3) > 0.5 ? [2.4, 0.4, 1.3] : [0.4, 1.9, 2.4];
                B.add(IDENTITY, cx - w / 2 + 0.7, 6.3, h * 0.55, 0.3, 0.12, Math.min(4, h * 0.4), col[0], col[1], col[2], 1);
            }
            cursor += w; i++;
        }
        B.end();

        this.lights = L.slice(0, MAX_LIGHTS);
        this.light.setCount(this.lights.length);
        this._writeLights(0);
        if (this.slotMode) this.showSlots(this.slotMode.kind, s, this.slotMode.except);
    }

    /** An empty plot: corner marks on the concrete. */
    _plot(B, x) {
        for (const [dx, dy] of [[-1.2, 1.95], [1.2, 1.95], [-1.2, 4.2], [1.2, 4.2]]) {
            B.add(IDENTITY, x + dx - Math.sign(dx) * 0.2, dy, 0.02, 0.5, 0.07, 0.03, 0.5, 0.5, 0.62, 0.35);
            B.add(IDENTITY, x + dx, dy + (dy < 3 ? 0.2 : -0.2), 0.02, 0.07, 0.5, 0.03, 0.5, 0.5, 0.62, 0.35);
        }
    }

    /** One stall. `open`: someone is working it tonight (the sign and lanterns are lit). */
    _stall(B, x, type, level, open, color) {
        const c = color, on = open ? 1 : 0.14;
        frameAt(F, x, 0, 0);
        B.add(F, 0, 3.15, 0.03, 2.75, 2.6, 0.06, c[0] * 0.16 + 0.06, c[1] * 0.16 + 0.06, c[2] * 0.16 + 0.07);              // mat
        B.add(F, 0, 2.25, 0.5, 2.5, 0.6, 1.0, WOOD[0], WOOD[1], WOOD[2]);                                                  // counter
        B.add(F, 0, 2.25, 1.03, 2.62, 0.72, 0.06, TOP[0], TOP[1], TOP[2]);
        B.add(F, 0, 1.94, 0.55, 2.3, 0.03, 0.46, c[0] * 0.75, c[1] * 0.75, c[2] * 0.75, 0.3 * on + 0.1);                   // front panel
        for (const px of [-1.28, 1.28]) for (const py of [2.36, 4.32]) B.add(F, px, py, 1.5, 0.1, 0.1, 3.0, METAL[0], METAL[1], METAL[2]);
        B.add(F, 0, 4.38, 1.5, 2.66, 0.08, 3.0, 0.15, 0.14, 0.2);                                                           // back wall
        B.add(F, 0, 4.2, 1.5, 2.3, 0.28, 0.06, WOOD[0], WOOD[1], WOOD[2]);                                                  // shelf
        for (let k = 0; k < 4; k++) B.add(F, -0.9 + k * 0.6, 4.2, 1.66, 0.2, 0.2, 0.26, 0.5 + noise(k + x) * 0.5, 0.45, 0.3 + noise(k * 3 + x) * 0.5, 0.15);
        B.add(F, 0, 3.4, 3.05, 2.86, 2.3, 0.12, c[0] * 0.3 + 0.05, c[1] * 0.3 + 0.05, c[2] * 0.3 + 0.06);                   // roof
        for (let k = 0; k < 7; k++) {                                                                                        // striped awning edge
            const w = k % 2 === 0;
            B.add(F, -1.2 + k * 0.4, 2.27, 2.84, 0.4, 0.07, 0.34, w ? c[0] : 0.92, w ? c[1] : 0.92, w ? c[2] : 0.9, 0.18 * on);
        }
        // the sign, lit in the stall's colour
        B.add(F, 0, 2.62, 3.5, 2.2, 0.08, 0.86, DARK[0], DARK[1], DARK[2]);
        B.add(F, 0, 2.56, 3.5, 1.96, 0.08, 0.62, c[0] * 2.3 * on, c[1] * 2.3 * on, c[2] * 2.3 * on, 1);
        for (let k = 0; k < level; k++) B.add(F, 0.62 - k * 0.2, 2.5, 3.5, 0.11, 0.06, 0.11, 2.4 * on + 0.2, 2.4 * on + 0.2, 2.2 * on + 0.2, 1);   // level pips
        if (level >= 2) for (const px of [-1.32, 1.32]) { B.add(F, px, 2.2, 2.52, 0.05, 0.05, 0.3, METAL[0], METAL[1], METAL[2]); B.add(F, px, 2.2, 2.28, 0.26, 0.26, 0.32, WARM[0] * on, WARM[1] * on, WARM[2] * on, 1); }
        if (level >= 3) {
            B.add(F, 0, 2.6, 4.12, 1.3, 0.08, 0.4, 2.3 * on + 0.1, 2.2 * on + 0.1, 1.9 * on + 0.1, 1);
            for (let k = 0; k < 9; k++) B.add(F, -1.28 + k * 0.32, 2.22, 3.14, 0.09, 0.09, 0.09, WARM[0] * on, WARM[1] * on, WARM[2] * on * (k % 2 ? 1 : 0.4), 1);
        }
        // what's on the counter
        const z = 1.06;
        if (type === "skewers") {
            B.add(F, 0, 2.25, z + 0.07, 1.5, 0.5, 0.14, 0.12, 0.12, 0.13);
            B.add(F, 0, 2.25, z + 0.15, 1.36, 0.36, 0.03, 2.4 * on, 0.8 * on, 0.15 * on, 1);                                // coals
            for (let k = 0; k < 5; k++) {
                const sx = -0.52 + k * 0.26;
                B.add(F, sx, 2.25, z + 0.21, 0.03, 0.62, 0.03, 0.75, 0.62, 0.42);
                for (let j = 0; j < 3; j++) B.add(F, sx, 2.1 + j * 0.15, z + 0.21, 0.09, 0.1, 0.09, j === 1 ? 0.35 : 0.72, j === 1 ? 0.6 : 0.3, 0.14);
            }
        } else if (type === "dumplings") {
            for (const [bx, n] of [[-0.6, 3], [0.15, 2], [0.8, 1]]) {
                for (let j = 0; j < n; j++) B.add(F, bx, 2.25, z + 0.08 + j * 0.15, 0.52, 0.52, 0.13, 0.8, 0.66, 0.42);
                B.add(F, bx, 2.25, z + 0.04 + n * 0.15, 0.46, 0.46, 0.05, 0.9, 0.78, 0.55);
            }
        } else if (type === "noodles") {
            B.add(F, -0.65, 2.3, z + 0.24, 0.6, 0.5, 0.48, 0.16, 0.16, 0.18);
            B.add(F, -0.65, 2.3, z + 0.49, 0.5, 0.4, 0.03, 0.95, 0.8, 0.45, 0.3);
            for (const bx of [0.15, 0.6, 1.0]) { B.add(F, bx, 2.2, z + 0.07, 0.3, 0.3, 0.14, 0.93, 0.93, 0.95); B.add(F, bx, 2.2, z + 0.15, 0.22, 0.22, 0.03, 0.98, 0.82, 0.3, 0.25); }
        } else if (type === "tea") {
            B.add(F, -0.75, 2.32, z + 0.3, 0.5, 0.42, 0.6, 0.85, 0.85, 0.9);
            B.add(F, -0.75, 2.08, z + 0.34, 0.36, 0.03, 0.3, 0.9 * on + 0.2, 1.6 * on + 0.2, 2.2 * on + 0.2, 1);
            [[0.82, 0.6, 0.86], [0.6, 0.86, 0.66], [0.86, 0.74, 0.56], [0.95, 0.65, 0.75]].forEach((col, k) => {
                B.add(F, -0.05 + k * 0.33, 2.2, z + 0.15, 0.16, 0.16, 0.3, col[0], col[1], col[2], 0.2);
                B.add(F, -0.02 + k * 0.33, 2.2, z + 0.36, 0.03, 0.03, 0.16, 0.95, 0.3, 0.4);
            });
        } else {
            B.add(F, 0, 2.25, z + 0.1, 1.2, 0.4, 0.2, 0.2, 0.05, 0.05);
        }
    }

    _writeLights(time) {
        this.lights.forEach((l, i) => {
            // stall lights breathe a little; a stall in the middle of an argument flickers
            let k = 1;
            if (l.stall != null) {
                const stall = this.state && this.state.stalls.find((t) => t.id === l.stall);
                k = 0.94 + 0.06 * Math.sin(time * 2.3 + i * 1.7);
                if (stall && stall.pauseT > 0 && !this.reducedMotion) k *= 0.55 + 0.45 * Math.sin(time * 31);
            }
            this.light.setLight(i, l.x, l.y, l.z, l.r, l.c[0] * k, l.c[1] * k, l.c[2] * k);
        });
    }

    // ------------------------------------------------------------------ markers
    /** Highlight slots: kind "free" (empty ones, for placing) or "all" (for moving), or null to hide. */
    showSlots(kind, s, except = -1) {
        this.slotMode = kind ? { kind, except } : null;
        this.slotTiles.forEach((e, i) => {
            const taken = s && !!stallAt(s, i);
            e.visible = !!kind && s && i < s.slots && i !== except && (kind === "all" || !taken);
            e.mesh.material.color.set(taken ? [1.2, 0.8, 0.25] : [0.3, 1.2, 0.7]);
        });
    }

    /** Ring the thing with this anchor key ("c12", "v3", "s7"), or null to clear. */
    select(key) { this.selected = key; if (!key) this.ring.visible = false; }

    // ------------------------------------------------------------------ reactions to simulation events
    /** Call with state.events after each simulation step. */
    consume(s, events) {
        const few = this.reducedMotion ? 0.3 : 1;
        for (const e of events) {
            if (e.type === "served") {
                const a = this.anchors.get("s" + e.stallId);
                if (a) this.sparks.emit(Math.round((6 + e.price * 0.8 + e.tip * 2) * few), { position: [a[0], 1.6, 1.35], spread: 0.15, velocity: [0, -0.6, 3.6], speed: 1.5, life: [0.45, 0.85], size: [0.2, 0.05], color: [2.6, 1.9, 0.5, 1], colorEnd: [2.2, 1.0, 0.1, 0] });
                if (e.mistake && a) this.steam.emit(Math.round(14 * few), { position: [a[0], 2.25, 1.3], spread: 0.3, velocity: [0, 0, 1.2], speed: 0.6, life: [0.7, 1.3], size: [0.5, 1.2], color: [0.15, 0.13, 0.13, 0.6], colorEnd: [0.1, 0.1, 0.1, 0] });
            } else if (e.type === "review") {
                const m = this.memo.get("c" + e.id);
                if (m && e.stars >= 4) { m.cheer = 1.2; const a = this.anchors.get("c" + e.id); if (a) this.sparks.emit(Math.round(8 * few), { position: [a[0], a[1], a[2] + 0.2], spread: 0.2, velocity: [0, 0, 2.6], speed: 1.2, life: [0.5, 0.9], size: [0.22, 0.04], color: [2.6, 0.7, 1.3, 1] }); }
            } else if (e.type === "angry") {
                const a = this.anchors.get("c" + e.id);
                if (a) this.sparks.emit(Math.round(12 * few), { position: [a[0], a[1], a[2] + 0.1], spread: 0.15, velocity: [0, 0, 2.2], speed: 1.6, life: [0.35, 0.7], size: [0.24, 0.04], color: [3.0, 0.3, 0.2, 1] });
            } else if (e.type === "scene") {
                const a = this.anchors.get("s" + e.a), b = this.anchors.get("s" + e.b);
                if (a && b) this.sparks.emit(Math.round(50 * few), { position: [(a[0] + b[0]) / 2, 2.6, 2.0], spread: 0.5, velocity: [0, 0, 2.5], speed: 3.2, life: [0.4, 1.0], size: [0.26, 0.04], color: [3.2, 0.5, 0.15, 1] });
                if (!this.reducedMotion) this.game.juice.shake(0.12);
            } else if (e.type === "gone") { this.memo.delete("c" + e.id); this.anchors.delete("c" + e.id); }
        }
    }

    /** Forget everyone (new night, loaded save, different state). */
    reset() { this.memo.clear(); for (const k of [...this.anchors.keys()]) if (k[0] !== "s") this.anchors.delete(k); this.steam.clear(); this.sparks.clear(); }

    _memo(key, x, y, yaw) {
        let m = this.memo.get(key);
        if (!m) { m = { x, y, yaw, phase: Math.random() * TAU, cheer: 0, walk: 0, seed: Math.random() * 10 }; this.memo.set(key, m); }
        return m;
    }

    // ------------------------------------------------------------------ per rendered frame
    /**
     * Draw everyone. `time`: seconds, for idle motion. `dt`: frame time. `running`: the simulation is
     * advancing (when it is paused, people hold their pose instead of jogging on the spot).
     */
    frame(s, time, dt, running) {
        this.state = s;
        const C = this.chars, live = s.phase === "night", A = this.anchors;
        C.begin();

        // ---- vendors behind their counters
        for (const stall of s.stalls) {
            const v = stall.vendorId != null ? vendorById(s, stall.vendorId) : null;
            if (!v || !v.hired || v.off) continue;
            const x = slotX(stall.slot), key = "v" + v.id, m = this._memo(key, x, STREET.vendorY, Math.PI);
            let action = "counter", yaw = Math.PI, lookAt = 0;
            const near = neighbours(s, stall);
            if (live && stall.pauseT > 0) {
                // mid-argument: turn on the rival next door
                const foe = near.find((n) => relation(s, v.id, n.vendor.id) === "rival");
                action = "argue";
                if (foe) yaw = Math.atan2(-(slotX(foe.stall.slot) - x), -0.6);
            } else if (live && stall.serving != null) action = "serve";
            else if (live && v.energy < 30) action = "tired";
            else {
                // between customers the people next door get a wave or a glare
                const cycle = (time * 0.35 + m.seed) % 4;
                for (const n of near) {
                    const r = relation(s, v.id, n.vendor.id, true), side = Math.sign(slotX(n.stall.slot) - x);
                    if (r === "friend" && cycle < 0.6) { action = "wave"; lookAt = side * 1.0; }
                    else if (r === "rival" && cycle > 2 && cycle < 3.2) lookAt = side * 1.2;
                }
            }
            m.yaw += shortAngle(yaw - m.yaw) * Math.min(1, dt * 9);
            drawCharacter(C, { x, y: STREET.vendorY, yaw: m.yaw, look: v.look, action, t: time + m.seed, look_at: lookAt, prop: "apron", accent: STALLS[stall.type].color });
            setAnchor(A, key, x, STREET.vendorY, 1.95 * v.look.h);
        }
        // hired but without a stall: waiting by the left gate
        let idle = 0;
        for (const v of hiredVendors(s)) {
            if (v.stallId != null && !v.off) continue;
            const x = -1.0 - idle * 0.85, y = 0.7 - (idle % 2) * 0.7, key = "v" + v.id, m = this._memo(key, x, y, 0);
            idle++;
            drawCharacter(C, { x, y, yaw: -1.2, look: v.look, action: v.off ? "tired" : "wait", t: time + m.seed, prop: "apron" });
            setAnchor(A, key, x, y, 1.95 * v.look.h);
        }

        // ---- customers
        for (const c of s.customers) {
            const key = "c" + c.id, m = this._memo(key, c.x, c.y, Math.atan2(-c.fx, c.fy));
            const moved = Math.hypot(c.x - m.x, c.y - m.y);
            m.x = c.x; m.y = c.y;
            const walking = c.state === "walk" || (c.state === "queue" && !c.atSpot);
            m.walk += ((walking && running ? 1 : 0) - m.walk) * Math.min(1, dt * 10);
            m.phase += Math.min(moved, 0.5) * 4.6;
            m.yaw += shortAngle(Math.atan2(-c.fx, c.fy) - m.yaw) * Math.min(1, dt * 10);
            if (m.cheer > 0 && running) m.cheer -= dt;
            const tired = c.patience / c.patienceMax;
            let action = "idle";
            if (m.cheer > 0) action = "cheer";
            else if (c.angry) action = "storm";
            else if (c.state === "queue" && c.atSpot) action = tired < 0.35 ? "fidget" : "wait";
            else if (c.state === "served") action = "reach";
            else if (c.state === "eat") action = c.holding === "tea" ? "drink" : "eat";
            else if (c.state === "linger") action = c.kind === "rival" ? "watch" : "wait";
            drawCharacter(C, { x: c.x, y: c.y, yaw: m.yaw, look: c.look, walk: m.walk, phase: m.phase, action, t: time + m.seed, prop: PROPS[c.kind], holding: c.holding });
            setAnchor(A, key, c.x, c.y, 1.95 * c.look.h);
            if (c.kind === "kid") {
                // Biscuit trails a step behind and sits when Pip stops
                const bx = c.x - c.fx * 0.75 + 0.35, by = c.y - c.fy * 0.75 - 0.2;
                m.dx = m.dx == null ? bx : m.dx + (bx - m.dx) * Math.min(1, dt * 6);
                m.dy = m.dy == null ? by : m.dy + (by - m.dy) * Math.min(1, dt * 6);
                m.sit = (m.sit || 0) + ((walking ? 0 : 1) - (m.sit || 0)) * Math.min(1, dt * 5);
                drawDog(C, m.dx, m.dy, m.yaw, time, m.walk, m.sit);
            }
        }
        C.end();

        // ---- steam over every working stall, more of it while serving
        this.steamClock += dt;
        if (this.steamClock > 0.09 && running) {
            this.steamClock = 0;
            for (const stall of s.stalls) {
                if (!worker(s, stall) || STALLS[stall.type].drink) continue;
                const busy = live && stall.serving != null;
                if (Math.random() > (busy ? 0.9 : 0.25) * (this.reducedMotion ? 0.3 : 1)) continue;
                const x = slotX(stall.slot) + (stall.type === "noodles" ? -0.65 : (Math.random() - 0.5) * 1.2);
                this.steam.emit(1, { position: [x, 2.25, 1.35], spread: 0.12, velocity: [0, 0, 0.5], speed: 0.25, life: [0.9, 1.7], size: [0.22, 0.9], color: [0.75, 0.75, 0.8, busy ? 0.3 : 0.18], colorEnd: [0.6, 0.6, 0.7, 0] });
            }
        }

        this._writeLights(time);

        // ---- markers
        if (this.slotMode) for (const e of this.slotTiles) e.mesh.material.opacity = 0.28 + 0.14 * Math.sin(time * 4);
        const a = this.selected && A.get(this.selected);
        this.ring.visible = !!a;
        if (a) {
            const isStall = this.selected[0] === "s";
            this.ring.setPosition(a[0], isStall ? STREET.stallY + 0.05 : a[1], 0.08);
            this.ring.setScale(isStall ? 1.75 : 0.5, isStall ? 1.6 : 0.5, 1);
            this.ring.setYaw(isStall ? 0 : time * 1.5);
        }
    }

    // ------------------------------------------------------------------ picking
    /**
     * What is under this screen point? Characters win over stalls, stalls over empty plots.
     * @returns {{ type: "customer" | "vendor" | "stall" | "slot", id: number } | null}
     */
    pick(px, py, width, height) {
        const cam = this.game.camera, out = { x: 0, y: 0, depth: 0, visible: false };
        let best = null, bestD = 34;
        for (const [key, a] of this.anchors) {
            if (key[0] === "s") continue;
            cam.project([a[0], a[1], a[2] * 0.55], width, height, out);
            if (!out.visible) continue;
            // a body is taller than it is wide on screen
            const d = Math.hypot(out.x - px, (out.y - py) * 0.6);
            if (d < bestD) { bestD = d; best = { type: key[0] === "c" ? "customer" : "vendor", id: Number(key.slice(1)) }; }
        }
        if (best) return best;
        const g = this.groundPoint(px, py, width, height), s = this.state;
        if (!g || !s) return null;
        const slot = Math.round(g.x / STREET.slotW);
        // the stall's footprint, plus a generous band above it on screen where the roof and sign are
        if (slot < 0 || slot >= s.slots || Math.abs(g.x - slotX(slot)) > 1.45 || g.y < 1.6 || g.y > 9) return null;
        const stall = stallAt(s, slot);
        if (stall) return { type: "stall", id: stall.id };
        return g.y < 4.6 ? { type: "slot", id: slot } : null;
    }

    /** Where a screen point meets the ground plane (z = 0). */
    groundPoint(px, py, width, height) {
        const ray = this.game.camera.screenRay(px, py, width, height);
        if (ray.direction[2] >= -1e-4) return null;
        const t = -ray.origin[2] / ray.direction[2];
        return { x: ray.origin[0] + ray.direction[0] * t, y: ray.origin[1] + ray.direction[1] * t };
    }
}

function setAnchor(map, key, x, y, z) {
    const a = map.get(key);
    if (a) { a[0] = x; a[1] = y; a[2] = z; } else map.set(key, [x, y, z]);
}
function shortAngle(d) { return ((d + Math.PI * 3) % TAU + TAU) % TAU - Math.PI; }

