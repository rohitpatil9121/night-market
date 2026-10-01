<div align="center">

# NIGHT MARKET

### A street-food tycoon where the staff and the regulars are the game

`JavaScript` · `WebGL2` · `GLSL` · `Projection Lab engine` · `No build step`

</div>

---

## The game

You run a neon-lit food street for ten nights. You place stalls, hire vendors, set prices, and open up. Customers
walk in hungry, pick a stall, queue, eat, and leave a review. Rent is due every night and it keeps rising.

The money side is a familiar tycoon loop. What makes it different is that **everyone on the street is a
person**. Each vendor has a name, a skill level, an energy bar, a mood and two traits, and they have history
with each other. Two friends working side by side serve faster and cook better. Two rivals side by side slow each
other down, and now and then stop serving to argue in front of both queues. So the layout is a people puzzle:
who you hire, and who you put next to whom, matters as much as what you sell.

- **4 stall types**: skewers (fast, cheap), dumplings (steady, long queue), noodles (slow, the best reviews) and
  bubble tea (a drink, bought on top of a meal). Each upgrades twice.
- **8 vendor traits**: Fast Hands, Perfectionist, Chatty, Hothead, Night Owl, Penny Pincher, Showman, Mentor.
- **Friends and rivals**: some are on record when you hire, some only come out when two people first work side by side.
- **6 regulars** with their own rules and stories: a food critic who never says when she's coming, a broke
  student, your landlord, a rival owner scouting your best vendor, a night-shift nurse, and a kid with a dog.
- **20 closing events**: after every night, one decision drawn from what actually happened.
- **Click anyone** to see who they are and, in plain words, what each of their traits and relationships is doing right now.
- A 10-night campaign with a 3-star rating, then **endless mode**. The campaign saves itself, even mid-night.

### One night

1. **Before opening.** Place or move stalls, hire and assign vendors, set prices. No timer.
2. **The night runs** for about three minutes at normal speed. Pause, or run at 2× or 4×. You can change prices while it runs.
3. **Closing.** Takings, costs, reviews, the best and worst moments, and one event that asks you to choose.
4. **Spend** on new stalls, upgrades or a longer street, and go again.

## Controls

| Input | Action |
|---|---|
| Click / tap a person or a stall | See who they are and what they're doing |
| Click an empty spot, then a stall type | Buy a stall there (or the other way round) |
| Drag | Move along the street |
| Wheel / pinch | Zoom |
| `A` `D` / `←` `→` | Move along the street |
| `Q` `E` | Turn the camera |
| `Z` `X` | Zoom in / out |
| `Space` | Pause / resume the night |
| `1` `2` `3` | Speed 1× / 2× / 4× |
| `Esc` | Cancel, close the card, or open the menu |

Building and staffing also work with `Tab` and `Enter`: stalls and staff are listed in the panels, and regulars
on the street appear as buttons in the bar at the bottom.

## How it's built

No three.js and no bundler. Plain ES modules served as static files.

```
night-market/
├── index.html, style.css     interface: title, HUD, build panels, cards, closing, event, settings
├── game/
│   ├── data.js               every number and name: stalls, traits, regulars, economy
│   ├── sim.js                the whole simulation (pure, deterministic, no DOM)
│   ├── events.js             the 20 closing events and their consequences
│   ├── bots.js               scripted players (the balance tool and the title screen use them)
│   ├── gfx.js                the night-street material, light list, instanced box batch
│   ├── characters.js         box-built people (and one dog) and their poses
│   ├── world.js              the 3D scene: street, stalls, characters, particles, picking
│   └── main.js               screens, input, camera, labels, saving
├── tools/balance.mjs         headless balance check (Node)
├── tools/serve.mjs           tiny static server for local play
├── engine/, shaders/         Projection Lab engine (copied from the engine repo)
└── vendor/                   pinned third-party code and fonts
```

### A simulation with no rendering in it

`game/sim.js` takes a state and steps it at a fixed 60 Hz. It never touches the DOM, the clock or
`Math.random`: every random draw goes through a seeded generator whose seed is stored in the state. The state
is plain JSON. One piece of code therefore drives live play, 4× fast-forward, saving and resuming mid-night,
the bot behind the title screen, and the balance tool. `game/world.js` only reads the state and draws it.

### Balance is checked, not guessed

`npm run balance` plays the campaign headless on 40 seeds with scripted strategies and fails if any of these stop being true:

1. doing nothing loses;
2. a sensible mixed street wins at least 90% of the time, with a real but not runaway margin;
3. no single stall type on its own does as well as the mix;
4. ignoring who stands next to whom costs money;
5. buying the cheapest thing every night does worse than planning.

`npm run balance -- --trace sensible 7` prints one campaign night by night.

### Rendering: Projection Lab

The engine is **[Projection Lab](https://github.com/rohitpatil9121/projection_library)**: an orbit camera on a
sphere, a hand-built view basis and dot-product projection, with no matrix camera.

| Engine system | Used here for |
|---|---|
| `Game`, `Loop`, `Input` | Fixed 60 Hz steps, action mapping, drag / wheel / pinch |
| `Camera` | The tycoon view, plus `project()` for labels and `screenRay()` for picking |
| `InstancedMesh` | Every box on the street in two draw calls |
| `ShaderMaterial`, `projectLab()` | The night-street material and the ground |
| `Sky` | A custom city-night sky shader |
| `PostFX` | HDR bloom on signs and lanterns, tone mapping, vignette, grain |
| `ParticleSystem` | Steam, coins, sparks when rivals argue |
| `Juice`, `Audio` | Camera shake, synthesised sound (ZzFX) and an ambient drone |

Three things the engine doesn't have, and what the game does instead:

- **Point lights.** The engine lights with one sun and a hemisphere ambient. `game/gfx.js` adds a material that
  reads up to 24 coloured point lights from uniform arrays: one per open stall, plus lamps and gates. The street
  surface reads the same list, which is what puts a pool of colour on the ground in front of each stall. A stall
  with nobody working it has no light and a dark sign.
- **Skeletal animation.** A character is about 14 boxes on a small hand-built skeleton (hips, torso, head, two
  arms, two legs). Poses are a few joint angles per action: walking, queueing, fidgeting, reaching, eating,
  cheering, storming off, serving, arguing, waving.
- **Text.** Stall tags, name tags, prices and the icons over vendors' heads are DOM elements placed each frame
  with `camera.project()`.

**Draw calls.** The renderer draws once per entity mesh, so 50 six-part characters as entities would be 300 draw
calls before any stalls. Instead every solid thing is a unit box in one of two `InstancedMesh` batches: street
furniture (rebuilt only when the layout changes) and characters (rewritten every frame). A unit cube with a
per-instance matrix shades correctly even when stretched, because a box's face normals lie along its own axes.
A full endless-mode street (8 stalls, 35 customers, about 1,000 boxes) renders in **5 draw calls**.

## Accessibility

- Every control is a real button or select with a label; visible focus rings; touch targets of at least 44 px
- Stalls, staff and regulars can all be reached from the panels without the mouse; ordinary customers can only be picked by clicking them
- **Reduce motion** (also follows the system setting): no camera shake or title drift, fewer particles
- Bloom can be switched off for slower devices
- On phones the build panel, the cards and the speed buttons sit at the bottom of the screen

## Run locally

ES modules need HTTP (not `file://`):

```bash
npm start
```

Then open http://localhost:8137. Any static server works too:

```bash
npx http-server . -p 8080
```

Re-check the economy after editing `game/data.js`:

```bash
npm run balance
```

## Credits

- Engine: [Projection Lab](https://github.com/rohitpatil9121/projection_library), built on
  [projection_library](https://github.com/rohit-s-init/projection_library) by Rohit Sawant
- Third-party code and fonts: see [THIRD_PARTY.md](THIRD_PARTY.md)
