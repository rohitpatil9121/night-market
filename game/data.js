/**
 * NIGHT MARKET — data: every number and every piece of text the simulation uses.
 * No logic here beyond tiny lookups, so balance changes are one-line edits (then run `npm run balance`).
 * @module game/data
 */

export const NIGHT = Object.freeze({
    /** one night at 1x speed, in seconds */
    seconds: 180,
    /** fixed simulation step */
    dt: 1 / 60,
    campaignNights: 10,
    /** after closing time, customers already in the street get this long to finish */
    grace: 28,
    /** clock shown in the HUD: opening and closing hour */
    openHour: 18, closeHour: 24,
});

/** Street geometry (world units, Z-up). Stalls sit in a row along +X; the camera looks from −Y. */
export const STREET = Object.freeze({
    slotW: 3,
    startSlots: 6,
    maxSlots: 10,
    /** cost of each extension (two more slots each) */
    extendCost: [220, 360],
    stallY: 3.1,
    vendorY: 2.95,
    queueY0: 1.15,
    queueGap: 0.6,
    laneY: [-4.7, -3.3],
    eatY: [-7.0, -5.6],
    /** how far beyond the last slot customers appear */
    margin: 6,
});

export const ECON = Object.freeze({
    startCash: 400,
    startRep: 30,
    rentBase: 35,
    rentStep: 17,
    hireFee: 30,
    sellRefund: 0.5,
    /** customers per night = base + rep · perRep + night · perNight */
    arrivals: { base: 22, perRep: 0.7, perNight: 3 },
    /** reputation points per review star above/below 3 */
    repPerStar: 0.2,
    repAngry: -0.7,
    repWalked: -0.06,
    repDecay: 0.5,
});

/**
 * Stall types. price: default price, cost: ingredients per serve, serve: seconds at skill 3,
 * upkeep: fixed cost per night, sat: base satisfaction 0..1, queue: places in line.
 */
export const STALLS = Object.freeze({
    skewers: {
        id: "skewers", name: "Skewers", icon: "🍢", buy: 110, price: 6, cost: 1.5, serve: 4.2, upkeep: 8, sat: 0.6, appeal: 1.0, queue: 5,
        color: [1.0, 0.42, 0.16], blurb: "Fast and cheap. Clears a queue quickly, earns little per head.",
    },
    dumplings: {
        id: "dumplings", name: "Dumplings", icon: "🥟", buy: 160, price: 9, cost: 2.5, serve: 6.0, upkeep: 12, sat: 0.72, appeal: 1.0, queue: 7,
        color: [0.35, 0.9, 0.55], blurb: "Steady all-rounder with room for a long queue.",
    },
    noodles: {
        id: "noodles", name: "Noodles", icon: "🍜", buy: 240, price: 14, cost: 4, serve: 9.0, upkeep: 16, sat: 0.86, appeal: 1.1, queue: 5,
        color: [1.0, 0.25, 0.5], blurb: "Slow and expensive. The best reviews on the street.",
    },
    tea: {
        id: "tea", name: "Bubble Tea", icon: "🧋", buy: 130, price: 6, cost: 1.2, serve: 3.6, upkeep: 8, sat: 0.7, appeal: 0.95, queue: 5, drink: true,
        color: [0.3, 0.75, 1.0], blurb: "A drink. Thirsty customers buy it on top of their meal.",
    },
});
export const STALL_TYPES = Object.freeze(Object.keys(STALLS));
export const MEAL_TYPES = Object.freeze(STALL_TYPES.filter((t) => !STALLS[t].drink));

/** Upgrade levels 1..3: serve-time multiplier, extra queue places, appeal multiplier, cost as a fraction of buy price. */
export const LEVELS = Object.freeze([
    null,
    { serve: 1, queue: 0, appeal: 1, cost: 0, label: "Basic" },
    { serve: 0.88, queue: 2, appeal: 1.15, cost: 0.75, label: "Better equipment" },
    { serve: 0.76, queue: 4, appeal: 1.32, cost: 1.3, label: "Flagship" },
]);

/** Vendor traits. The numbers are read by sim.js; `text` is what the character card shows. */
export const TRAITS = Object.freeze({
    fast: { id: "fast", name: "Fast Hands", icon: "⚡", serve: 0.78, text: "Serves 22% quicker." },
    perfectionist: { id: "perfectionist", name: "Perfectionist", icon: "✨", serve: 1.2, sat: 0.15, text: "Serves 20% slower, but every plate reviews better." },
    chatty: { id: "chatty", name: "Chatty", icon: "💬", patience: 0.6, text: "Customers in this queue lose patience 40% more slowly." },
    hothead: { id: "hothead", name: "Hothead", icon: "🔥", queue: 4, mistake: 0.4, text: "Fine with a short queue. With 4 or more waiting, botches orders." },
    owl: { id: "owl", name: "Night Owl", icon: "🦉", after: 0.55, text: "Loses no energy in the second half of the night." },
    penny: { id: "penny", name: "Penny Pincher", icon: "🪙", cost: 0.7, sat: -0.07, text: "Ingredients cost 30% less. Reviews dip a little." },
    showman: { id: "showman", name: "Showman", icon: "🎪", appeal: 1.3, text: "Draws a crowd: the stall is 30% more appealing." },
    mentor: { id: "mentor", name: "Mentor", icon: "🎓", xp: 1.8, text: "Vendors in the stalls next door gain skill 80% faster." },
});
export const TRAIT_IDS = Object.freeze(Object.keys(TRAITS));

export const VENDOR = Object.freeze({
    poolSize: 14,
    marketSize: 4,
    wageBase: 8, wagePerSkill: 6,
    maxSkill: 5,
    /** serves needed to go from skill n to n+1 */
    xpPerLevel: 22,
    /** serve-time multiplier by skill: 1.24 at skill 1 down to 0.8 at skill 5 */
    skillServe: (skill) => 1.35 - 0.11 * skill,
    energyIdle: 0.26, energyServe: 0.3,
    tiredBelow: 30,
    /** below 50 energy the serve time stretches, up to this much at 0 */
    tiredSlow: 0.45,
    friendServe: 0.84, rivalServe: 1.2,
    friendSat: 0.06, rivalSat: -0.08, sceneRep: -1.2,
    sceneEvery: 22, sceneChance: 0.35, scenePause: 6, scenePatience: 9,
    quitMood: 25,
});

export const CUSTOMER = Object.freeze({
    speed: [1.9, 2.5],
    budget: [6, 28],
    patience: [22, 44],
    thirsty: 0.42,
    /** satisfaction lost when a thirsty customer finds no drink stall */
    noDrink: 0.12,
    eat: [5, 8], drink: [2.5, 4],
    /** a stall has to score at least this for the customer to bother */
    minScore: 0.5,
});

export const VENDOR_NAMES = Object.freeze([
    "Mei", "Arjun", "Tomás", "Yuki", "Fatima", "Kofi", "Linh", "Dmitri", "Rosa", "Sanjay", "Aiko", "Omar", "Priya", "Jun", "Nadia", "Leo", "Hana", "Marco",
]);
export const CUSTOMER_NAMES = Object.freeze([
    "Ana", "Ben", "Chen", "Dee", "Eli", "Fay", "Gus", "Hiro", "Ines", "Jay", "Kim", "Lou", "Mia", "Nico", "Ola", "Pax", "Quinn", "Ravi", "Sol", "Tess",
    "Uma", "Vik", "Wren", "Xio", "Yara", "Zed", "Asha", "Bo", "Cleo", "Dai", "Esme", "Finn", "Gia", "Hal", "Ivy", "Jude", "Kai", "Lena", "Milo", "Noor",
]);

/**
 * The six regulars. `look` indexes the palettes in characters.js; `prop` picks the accessory.
 * Their mechanics live in sim.js (spawnRegulars / hooks) and their stories in events.js.
 */
export const REGULARS = Object.freeze({
    critic: {
        id: "critic", name: "Ms. Vane", title: "Food critic", prop: "notebook", look: { skin: 1, shirt: 9, pants: 0, hair: 3, hairStyle: 2, h: 1.02 },
        blurb: "Writes for the city paper and never says when she's coming. Her one review doubles the night's reputation swing, up or down.",
    },
    student: {
        id: "student", name: "Bao", title: "Broke student", prop: "backpack", look: { skin: 2, shirt: 4, pants: 2, hair: 0, hairStyle: 1, h: 0.96 },
        blurb: "Three dollars to his name and always hungry. Whether you feed him is up to you.",
    },
    landlord: {
        id: "landlord", name: "Mr. Okafor", title: "Your landlord", prop: "tophat", look: { skin: 4, shirt: 8, pants: 0, hair: 0, hairStyle: 0, h: 1.08 },
        blurb: "Owns the street and visits every third night. Keep him waiting and the rent climbs faster. Feed him well and it holds.",
    },
    rival: {
        id: "rival", name: "Dario Finch", title: "Rival owner", prop: "shades", look: { skin: 0, shirt: 7, pants: 0, hair: 1, hairStyle: 3, h: 1.04 },
        blurb: "Runs the market two streets over. He isn't here for the food: he's watching your best vendor.",
    },
    nurse: {
        id: "nurse", name: "Imani", title: "Night-shift nurse", prop: "cap", look: { skin: 3, shirt: 10, pants: 3, hair: 0, hairStyle: 2, h: 0.98 },
        blurb: "Comes late, on her break. Tips well if whoever serves her still has some energy left.",
    },
    kid: {
        id: "kid", name: "Pip", title: "Kid with a dog", prop: "dog", look: { skin: 1, shirt: 5, pants: 1, hair: 2, hairStyle: 1, h: 0.72 },
        blurb: "Pip and Biscuit stop wherever something smells good, and people stop with them. Stalls nearby get busier.",
    },
});

/** How loudly the HUD tells the player what to do next during the first night. */
export const HINTS = Object.freeze({
    noStall: "Buy a stall and put it on the street.",
    noVendor: "Hire a vendor to run it.",
    unstaffed: "A stall has nobody working it. Assign a vendor.",
    ready: "Ready to open. People crave different things, so a second kind of stall catches more of the crowd.",
});
