/**
 * The crow, the first pet: it lives on the ground among the plants and now and
 * then takes to the air. It walks, hops and pecks, and sometimes flies off,
 * glides and lands somewhere else in the world. When the camera has moved on
 * and left it out of sight, it flies over to where the camera is. A tap
 * startles it into the air; a hold makes it hop.
 */
import './shim';
import { PIXEL_SCALE } from './model';
import type { PetLife, PetScene, PetSpot } from './pets';

/**
 * Crow atlas: 160 x 160 PNG, 8 x 8 cells, each frame 20 x 20 native pixels.
 *
 * Rows in order: idle/look, walk/hop, run/brake, peck/eat, takeoff, landing,
 * flight flap, glide/descend, eight frames each. CROW_ANIMS below says which
 * of them the crow plays; scripts/check-crow-atlas.mjs checks those carry art.
 */
export const CROW_ATLAS_URL =
    'data:image/png;base64,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';

export const CROW_PREVIEW_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAA8ElEQVR42u2WzwoBURSHvxERMY0ypFgYC/ICXtaLeAILeytl6U/RKEUWY6FTZjKZIcmd8+1up+6tr98554KiKIqiKIqSZaxvXWy3hgFAqWID0PFGAMynk1Rv5jJnsOx0A4BCsQLAoFcO1VebAgDnkw+Av15Yf20w/+kFTW8cPBqJEjUmSDb9zGZQulRwO/1Q/bjfPTX3KnPmZzAuc2JM5p3tuHdjh22o7qd8zzyDcd1aqzfCWYuYexfzulg2hSAbQ+ZanOm03WteBqPmkmYz6cYw32C13gZgs5xZSX4x18vpo+xl7z8YZ1DOxnaxovyaG8NcVP/WzCFXAAAAAElFTkSuQmCC';

type CrowAnimation =
    | 'idle'
    | 'walk'
    | 'run'
    | 'peck'
    | 'takeoff'
    | 'landing'
    | 'flight'
    | 'glide';
type CrowMode = 'resting' | 'walking' | 'hopping' | 'pecking' | 'flying';

const CROW_ANIMS: Record<CrowAnimation, { row: number; frames: number; duration: number }> = {
    idle: { row: 0, frames: 8, duration: 220 },
    walk: { row: 1, frames: 8, duration: 110 },
    run: { row: 2, frames: 8, duration: 70 },
    peck: { row: 3, frames: 8, duration: 150 },
    // Four frames crouched, then up: the lift starts halfway through.
    takeoff: { row: 4, frames: 8, duration: 90 },
    // Five frames in the air, then three on its feet.
    landing: { row: 5, frames: 8, duration: 90 },
    flight: { row: 6, frames: 8, duration: 80 },
    // The glide row's last frame stands on the ground, so the glide loops the seven before it.
    glide: { row: 7, frames: 7, duration: 140 },
};

const CROW_COLUMNS = 8;
const CROW_ROWS = 8;
/** One frame of the atlas, in art pixels. */
const CROW_FRAME = 20;
/** A frame in the world: art pixels at PIXEL_SCALE, like the rest of the scene. */
const CROW_SIZE = CROW_FRAME * PIXEL_SCALE;
/** From the top of a frame down to the ground under the crow's feet, in art pixels. */
const CROW_FEET = 18;
/** How close the crow comes to the ends of the world, or of the view. */
const CROW_EDGE = CROW_SIZE / 2 + 8;

// World px per ms.
const WALK_SPEED = 0.055;
const FLIGHT_SPEED = 0.3;
/** The height a takeoff gains before the crow flies off, and where its landing begins. */
const LIFT = 36;
/** How far forward a takeoff or a landing carries it. */
const LIFT_REACH = 20;
/** Shorter than this, a trip is a hop rather than a flight. */
const MIN_FLIGHT = 90;
/** Hold a finger on the crow this long and it hops. */
const HOLD_MS = 520;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
/** How long one play-through of an animation takes. */
const lengthOf = (name: CrowAnimation) => CROW_ANIMS[name].frames * CROW_ANIMS[name].duration;
const clear = (timer: number | null): null => {
    if (timer !== null) window.clearTimeout(timer);
    return null;
};

type Range = { min: number; max: number };

/** The crow's behaviour module: see PetType in pets.ts. */
export function mountCrow(layer: HTMLElement, scene: PetScene, spot: PetSpot | null): PetLife {
    const crow = layer.createEl('button', {
        cls: 'garden-pet garden-pet-crow',
        attr: { type: 'button', 'aria-label': 'Crow. Tap to make it fly. Hold to make it hop.' },
    });
    crow.setCssProps({ '--crow-atlas': 'url("' + CROW_ATLAS_URL + '")' });
    // Keep sprite scale self-contained so stale CSS can never shrink or mis-crop it.
    crow.setCssStyles({
        width: CROW_SIZE + 'px',
        height: CROW_SIZE + 'px',
        backgroundSize: (CROW_SIZE * CROW_COLUMNS) + 'px ' + (CROW_SIZE * CROW_ROWS) + 'px',
    });

    /** The whole world, less a margin at each end. */
    const world: Range = { min: CROW_EDGE, max: Math.max(CROW_EDGE, scene.width - CROW_EDGE) };

    /**
     * Where the crow wanders on foot: the part of the world the camera shows,
     * so it keeps to the garden being looked at. The world is far wider than
     * that slice, and roaming all of it walked the crow off screen for minutes.
     */
    const inView = (): Range => {
        const view = scene.view();
        if (!view) return world;
        const min = Math.max(world.min, view.left + CROW_EDGE);
        const max = Math.min(world.max, view.right - CROW_EDGE);
        return max > min ? { min, max } : world;
    };

    const seen = () => {
        const view = scene.view();
        return !view || (x > view.left && x < view.right);
    };

    /** A spot in `range` at least `away` from the crow, when the range has room for one. */
    const spotIn = (range: Range, away: number) => {
        for (let tries = 0; tries < 8; tries++) {
            const at = range.min + Math.random() * (range.max - range.min);
            if (Math.abs(at - x) >= away) return at;
        }
        return x - range.min > range.max - x ? range.min : range.max;
    };

    // The world's middle is the middle plant, so a crow new to this garden
    // starts beside it rather than out in the padding where the camera never looks.
    let x = clamp(spot?.x ?? scene.width / 2 + 70, world.min, world.max);
    let y = scene.horizon;
    let facing: 1 | -1 = spot?.facing ?? 1;
    let mode: CrowMode = 'resting';
    let animation: CrowAnimation = 'idle';
    let frame = 0;
    let live = false;

    let frameTimer: number | null = null;
    let frameToken = 0;
    let moveFrame: number | null = null;
    let moveToken = 0;
    let nextTimer: number | null = null;
    let holdTimer: number | null = null;
    let press: { x: number; y: number; at: number } | null = null;
    let held = false;

    /** (x, y) is where the feet touch; the frame hangs above them, mirrored when it faces left. */
    const place = (nextX: number, nextY: number) => {
        x = nextX;
        y = nextY;
        const left = Math.round(x - CROW_SIZE / 2);
        const top = Math.round(y - CROW_FEET * PIXEL_SCALE);
        crow.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)' + (facing < 0 ? ' scaleX(-1)' : '');
    };

    const face = (towards: number) => {
        facing = towards < 0 ? -1 : 1;
        place(x, y);
    };

    const showFrame = () => {
        crow.style.backgroundPosition = (-frame * CROW_SIZE) + 'px ' + (-CROW_ANIMS[animation].row * CROW_SIZE) + 'px';
        crow.dataset.state = mode;
    };

    const stopFrames = () => {
        frameToken++;
        frameTimer = clear(frameTimer);
    };

    /** Play an animation from its first frame; `once` holds the last frame instead of looping. */
    const play = (name: CrowAnimation, once = false) => {
        stopFrames();
        animation = name;
        frame = 0;
        showFrame();
        const token = frameToken;
        const spec = CROW_ANIMS[name];
        const step = () => {
            if (!live || token !== frameToken) return;
            if (once && frame === spec.frames - 1) {
                frameTimer = null;
                return;
            }
            frame = (frame + 1) % spec.frames;
            showFrame();
            frameTimer = window.setTimeout(step, spec.duration);
        };
        frameTimer = window.setTimeout(step, spec.duration);
    };

    const stopMoving = () => {
        moveToken++;
        if (moveFrame !== null) window.cancelAnimationFrame(moveFrame);
        moveFrame = null;
    };

    /** Carry the crow along `path` (t from 0 to 1, to feet positions) over `ms`, then `done`. */
    const travel = (ms: number, path: (t: number) => [number, number], done: () => void) => {
        stopMoving();
        const token = moveToken;
        const start = performance.now();
        const step = (now: number) => {
            if (!live || token !== moveToken) return;
            const t = Math.min(1, (now - start) / ms);
            place(...path(t));
            if (t < 1) {
                moveFrame = window.requestAnimationFrame(step);
            } else {
                moveFrame = null;
                done();
            }
        };
        moveFrame = window.requestAnimationFrame(step);
    };

    const rest = () => {
        mode = 'resting';
        place(x, scene.horizon);
        play('idle');
        nextTimer = clear(nextTimer);
        nextTimer = window.setTimeout(next, 1800 + Math.random() * 2600);
    };

    /** Walk a few steps along the ground, turning round at the edge of the view. */
    const walk = () => {
        const range = inView();
        const way = Math.random() < 0.5 ? -1 : 1;
        let target = clamp(x + way * (40 + Math.random() * 100), range.min, range.max);
        if (Math.abs(target - x) < 16) target = clamp(x - way * 60, range.min, range.max);
        if (Math.abs(target - x) < 4) return rest();
        mode = 'walking';
        face(target - x);
        play('walk');
        const from = x;
        travel(Math.abs(target - from) / WALK_SPEED, (t) => [from + (target - from) * t, scene.horizon], rest);
    };

    /** A hop is the walk cycle carried along an arc, so it has no frame of its own to go missing. */
    const hop = () => {
        const range = inView();
        const distance = 24 + Math.random() * 40;
        const target = clamp(x + (Math.random() < 0.5 ? -distance : distance), range.min, range.max);
        mode = 'hopping';
        face(target - x);
        play('walk');
        const from = x;
        travel(lengthOf('walk'), (t) => [from + (target - from) * t, scene.horizon - Math.sin(Math.PI * t) * 16], rest);
    };

    const peck = () => {
        mode = 'pecking';
        play('peck');
        const pecks = 1 + Math.floor(Math.random() * 2);
        nextTimer = clear(nextTimer);
        nextTimer = window.setTimeout(rest, pecks * lengthOf('peck'));
    };

    /**
     * Take off, fly an arc over the garden flapping on the way up and gliding
     * on the way down, and land at `target` on the ground.
     */
    const fly = (target: number) => {
        if (Math.abs(target - x) < MIN_FLIGHT) return hop();
        nextTimer = clear(nextTimer);
        mode = 'flying';
        const way = target > x ? 1 : -1;
        face(way);
        const ground = scene.horizon;

        // Up: crouched for the first half of the takeoff frames, then springing.
        const x0 = x;
        play('takeoff', true);
        travel(lengthOf('takeoff'), (t) => {
            const up = Math.pow(Math.max(0, (t - 0.45) / 0.55), 2);
            return [x0 + way * LIFT_REACH * up, ground - LIFT * up];
        }, () => {
            // Across: higher the further it goes.
            const from = x;
            const to = target - way * LIFT_REACH;
            const distance = Math.abs(to - from);
            const height = clamp(distance * 0.3, 40, 200);
            let gliding = false;
            play('flight');
            travel(clamp(distance / FLIGHT_SPEED, 700, 4000), (t) => {
                if (!gliding && t > 0.55) {
                    gliding = true;
                    play('glide');
                }
                return [from + (to - from) * t, ground - LIFT - Math.sin(Math.PI * t) * height];
            }, () => {
                // Down: the feet meet the ground with the sixth landing frame.
                const x1 = x;
                play('landing', true);
                travel(lengthOf('landing'), (t) => {
                    const down = 1 - Math.pow(1 - Math.min(1, t / 0.62), 2);
                    return [x1 + (target - x1) * down, ground - LIFT * (1 - down)];
                }, rest);
            });
        });
    };

    /** Where the crow goes next. Out of sight, it comes back to the view rather than living on off screen. */
    const next = () => {
        nextTimer = null;
        if (!live) return;
        if (!seen()) return fly(spotIn(inView(), 0));
        const roll = Math.random();
        if (roll < 0.36) walk();
        else if (roll < 0.62) peck();
        else if (roll < 0.8) hop();
        // Most flights stay in view; now and then one lands elsewhere in the world.
        else fly(spotIn(Math.random() < 0.7 ? inView() : world, 160));
    };

    const startle = () => {
        if (!live || scene.reducedMotion || mode === 'flying') return;
        fly(spotIn(inView(), 160));
    };

    const hopOnHold = () => {
        if (!live || scene.reducedMotion || mode === 'flying') return;
        nextTimer = clear(nextTimer);
        hop();
    };

    // The crow handles its own presses: the camera must not pan and the
    // garden's menus must not open under it.
    const keep = (e: Event) => e.stopPropagation();
    crow.addEventListener('touchstart', keep, { passive: true });
    crow.addEventListener('touchmove', keep, { passive: true });
    crow.addEventListener('touchend', keep, { passive: true });
    crow.addEventListener('mousedown', keep);
    crow.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    crow.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    crow.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        crow.setPointerCapture?.(e.pointerId);
        press = { x: e.clientX, y: e.clientY, at: performance.now() };
        held = false;
        holdTimer = clear(holdTimer);
        holdTimer = window.setTimeout(() => {
            holdTimer = null;
            if (!press) return;
            held = true;
            hopOnHold();
        }, HOLD_MS);
    });

    crow.addEventListener('pointermove', (e) => {
        if (!press || holdTimer === null) return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) holdTimer = clear(holdTimer);
    });

    crow.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        holdTimer = clear(holdTimer);
        const started = press;
        press = null;
        if (!started || held) return;
        if (Math.hypot(e.clientX - started.x, e.clientY - started.y) < 10 && performance.now() - started.at < HOLD_MS) {
            startle();
        }
    });

    crow.addEventListener('pointercancel', () => {
        holdTimer = clear(holdTimer);
        press = null;
    });

    crow.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        startle();
    });

    place(x, y);
    showFrame();

    return {
        start() {
            if (live) return;
            live = true;
            // Asked for less motion, the crow stands where it is, still.
            if (scene.reducedMotion) {
                animation = 'idle';
                frame = 0;
                place(x, scene.horizon);
                showFrame();
                return;
            }
            rest();
        },
        stop() {
            live = false;
            stopFrames();
            stopMoving();
            nextTimer = clear(nextTimer);
            holdTimer = clear(holdTimer);
            press = null;
            return { x, facing };
        },
    };
}
