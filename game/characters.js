import { Entity, SkinnedMesh, StandardMaterial, Animator, quat } from "../engine/index.js";

/**
 * NIGHT MARKET — characters. A person is one skinned mesh (assets/models/person.glb) driven by the
 * engine's Animator. Everyone shares the same skeleton, clips and material; what makes them individuals
 * is a small colour palette (skin, shirt, trousers, hair, accent) set per mesh, a choice of hair and
 * accessory baked into their geometry, and their height. Looks are plain data (palette indices), so the
 * simulation can generate and save them.
 * @module game/characters
 */

export const SKIN = [[0.99, 0.84, 0.7], [0.93, 0.74, 0.58], [0.82, 0.62, 0.46], [0.62, 0.44, 0.31], [0.44, 0.3, 0.22]];
export const SHIRT = [
    [0.9, 0.3, 0.3], [0.26, 0.54, 0.92], [0.98, 0.8, 0.28], [0.32, 0.76, 0.54], [0.66, 0.46, 0.9], [0.99, 0.56, 0.22],
    [0.93, 0.94, 0.96], [0.2, 0.21, 0.27], [0.36, 0.38, 0.47], [0.6, 0.14, 0.24], [0.56, 0.87, 0.9], [0.98, 0.6, 0.76],
];
export const PANTS = [[0.17, 0.18, 0.27], [0.24, 0.32, 0.52], [0.42, 0.35, 0.29], [0.56, 0.58, 0.62]];
export const HAIR = [[0.1, 0.09, 0.09], [0.34, 0.22, 0.12], [0.78, 0.56, 0.24], [0.6, 0.6, 0.63], [0.66, 0.2, 0.15]];
const DARK = [0.09, 0.08, 0.1], SHOES = [0.2, 0.17, 0.18], WHITE = [0.97, 0.96, 0.93];

/** CSS colour for a palette entry, for the DOM portraits on the cards. */
export const css = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

let sharedMaterial = null;
/** One material (so one shader program) for every person; each mesh brings its own palette. */
function personMaterial() {
    if (!sharedMaterial) sharedMaterial = new StandardMaterial({ palette: new Float32Array(StandardMaterial.PALETTE_SIZE * 3).fill(1) });
    return sharedMaterial;
}

export class Character {
    /**
     * @param {Awaited<ReturnType<import("./assets.js").loadAssets>>} assets
     * @param {{ skin: number, shirt: number, pants: number, hair: number, hairStyle: number, h: number }} look
     * @param {{ prop?: string | null, accent?: number[] }} [options] prop: apron | backpack | tophat | shades | cap | notebook
     */
    constructor(assets, look, options = {}) {
        this.animator = new Animator(assets.person.skeleton, assets.person.clips);
        /** place and turn this; the skinned body hangs under it, already stood upright */
        this.root = new Entity({ name: "person" });
        this.root.interpolate = false;
        this.root.setScale(look.h || 1);
        const mesh = new SkinnedMesh(assets.personGeometry(look.hairStyle, options.prop), personMaterial(), this.animator);
        const palette = new Float32Array(StandardMaterial.PALETTE_SIZE * 3);
        [SKIN[look.skin], SHIRT[look.shirt], PANTS[look.pants], HAIR[look.hair], DARK, SHOES, options.accent || WHITE, WHITE].forEach((c, i) => palette.set(c, i * 3));
        mesh.uniforms = { u_palette: palette };
        this.body = this.root.add(new Entity({ name: "body", mesh }));
        this.body.interpolate = false;
        quat.copy(this.body.rotation, assets.upright);
        this.clip = "";
        this.handR = assets.person.skeleton.index("handR");
        this.head = assets.person.skeleton.index("head");
    }

    /** Switch animation (cross-fades; calling it every frame with the same name is free). */
    play(name, options) { this.clip = name; this.animator.play(name, options); }

    /**
     * Advance the animation. `headTurn` (radians) is added to the head after sampling, so a clip and a
     * glance at the neighbour can combine.
     */
    update(dt, headTurn = 0) {
        const a = this.animator;
        a.sample(dt);
        if (headTurn) {
            // rotate the head's local pose about its own up axis (model up is Y in the file's space)
            const o = this.head * 10 + 3, h = headTurn / 2, s = Math.sin(h), c = Math.cos(h);
            const x = a.pose[o], y = a.pose[o + 1], z = a.pose[o + 2], w = a.pose[o + 3];
            a.pose[o] = x * c - z * s; a.pose[o + 1] = y * c + w * s; a.pose[o + 2] = z * c + x * s; a.pose[o + 3] = w * c - y * s;
        }
        a.solve();
    }
}

/** Biscuit. Returns { root, animator }: move and turn `root`, play "idle", "walk" or "sit". */
export function makeDog(assets) {
    const root = new Entity({ name: "dog" });
    root.interpolate = false;
    const model = assets.dog.instantiate();
    for (const c of model.children) c.interpolate = false;
    model.interpolate = false;
    root.add(model);
    return { root, animator: model.animator };
}
