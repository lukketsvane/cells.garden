import './shim';

/**
 * Crow atlas: 160 x 160 PNG, 8 x 8 cells, each frame 20 x 20 native pixels.
 *
 * Rows in order: idle/look, walk/hop, run/brake, peck/eat, takeoff, landing,
 * flight flap, glide/descend, eight frames each. The scene only drives the
 * ground rows today; the rest are described here so the sheet's layout lives
 * in one place.
 */
export const CROW_ATLAS_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAACgBAMAAAB54XoeAAAAJFBMVEUAAAAPGCkXIzgKER4lNU00RmM3OjPwyD4AAAAAAAAAAAAAAAAVDaa+AAAADHRSTlMA/////////wAAAADXf3DFAAAKm0lEQVR42u1az3McRxX+ukeyd+PybveMIakUFc/u2iQkVfaMNgUc5UDCKWBMUhTX/AW58M9woYpzqgLnHBxOcJF2wyHhEmnswuAEdqYlgTQreac59Hs9I+0gohAKCNuXfdU9/aanf3zf+14vsCqr8u8oImZLxv/8aen63PS9vaVvkPHTS1ylZNtbNn3dpneY3BlQZXKHn4x/pJ3xDhR1UNY7VK/xc/2HXJcO2eEge2+P+mRPDmiA5mfUvfhzyzTg5ICtN/h9uzYi69orNBgZvsJ14Rs0aPHdG9fIevUe962fuzbUMVl3IhphXEWpa7aIbtEYrJ8lkV6lz4ThD+7zcwobwtXGvagPYA2ACWzGzd4SxQMa9W7Mfj62/Jl79JwAULlmE6ACEAB4qciLEgDwkinYKsq8JD+HR86ao1OWACBe5OeC503u6vANk5sSkEAAa9zcBLAFjyEuaFz2uvFrQVYIS60JrHFW5L1AIoi8pdmh0H5FeUtho65L/Hb11kjTxq4A2mkVIBWtjvSbOPQbzda7WXgrOHNIVmVVVqWNaFo5RQ/9g6G32urCZQoY3PDH2lOAjF+NmFPe9FajTp9tleI9hhFzj8Fb/IB7eEBHONSEQfoVgnboYURWeCc6SwEIh9qTAVOAkGGPeW1DOXgTOlQOlAd6o+csraKep4Db7HqDRqDUhiWHykG5RzEAUEacBlUAcc15e3aXnsupr4BBxXNY5blD7Hg/3+MVmTkrGJq8IDxnSw6xVfBi5/TGYbXNqxxjl4dW7VZuZio7cVYvsxMaTAYaVm+HgR+w1GOjYlpAoDWxqBYpzzXGfoekHuRTTwEJ1WlwXwi3nBJYFJZjBGtz7pPl3HnXT90u0xAymuEChsOTetDNN3uqQMB9hdLeasYivJuFamlelVVZlc9U1rx146Jd9Y1TFgkf9RYfyH3fHnpFE97l93qrPtTi+8wB4nXtYmwMsXZTPAYA3Qn++sJj9771731UAoC+sl7YEgBkT+w5C/prhEZa/bZgKJsWboTafOfk3QkAoaM7J3YKAGmYntxXAJAGt46NcTSTEEYNtHjdjUsEI5YGQcqcArWXEJZVkkgqU6GaZACQ9SJJo+lFyAFA7L1sf1EQC6mE+SgigBWxIdUhPacEsWQ8j6WpqFUSDCpkyVWexHzKFDaj5R1K+3EBAOLWw2piSS7MFlSHfGHZ2qocg+3YjATScGeXEbdiaI8DzfwReJEQjXntUs2IPfaWZkuMmVMiXwekHrw1Ev7QBhnwO/SyOhkppc4Sl3PEvzVDLLfWVlzLIt1ircqq/O8XeUcty4rPoVM8sF+LTbPBHdTBtfyCDsMflw7Y5aWPOHuiny14hMqrhPMTcEHoP+znHzrreiL96b8b0QhDbOccNPau0hfoZ4wDqLLLQxC3D7/iWtX46GDhmOnFPuFgqH+Tk07BmHNakRLsbywoGBeN1mNiEvFgMOfsFiOs3MBZnSISlX4aUKQrHFhtZaFyrVL1IvHhXQCI7XWf3CLSgAL6fpVJp4QZYGcOYNE3joP386115bI2+3mFX7rOOzlPJskKoMoNkdSQlIh8TuakSXqZ3abJrixNgpSLiZq7rwNpEhHHmi3WM4hqrYHUWzqKCYF1OlCngT9SAVOFYrUQEWJLYIb9KbvJfFLUVJlZViruZ2b4MxfemjVEIaRPlw08L8gh8Pbb//C8DVrqVpzy35JuaU+zXLzwiir1xTgU/ld/MQ55XFacVckXcuhDJO9G4F+ZQ6H5YMZ+hLahFsTNcx3WNCTC+MwCZIBmN9E6YYdMfhjX0WTd+VsEnemiIuhPD8vLJYBut3zqaacC9p5avFY+BjBH52/zXYe/Znte8gi9kkre/IBgIvuUd4h5wjwj110Q+9BWx/enFBSH2wAg+lEKz3qi9xZ3fue6qzlIJSWP9Ag0aNM7LqYMhFOK7gsX0icCodcpenPNJo5Jxr0p7wvrd0jF8zUiFePvByLYHacMjF1s8SprsXZlMj09l3H18DmyTIbfOQnhJ/oWCRHMpvFO5nJc+4UxnPuyFlMSL9v0ndJWGVmolNNPFbvBLnMKeDaA2+7qRAKBxI6huMQWtAV2Yra2bOG2bziRe4ayUvsFb8R9drgd13tbU1ozbtyO1Gc0FWtn01cYn38Egsgrn3QZlxoSKDp7llflS8Y+nzWGb6UeQPuNUV8jiIs7bBCEtxgPIFR8UYc1hwX1RWCDSORncyj08hCrxmDZssqeP0QRO4e2FvfqfOoUjRAwXraSe5tuhEIrurk3y27qa3ljAH2X0yeH7Mdb+sGvPnAjtAb9IfVWdItiITf8q9NNqhPrjgCFTsQebwdxoFyqKsmZU6yAVQAECnGJtGDRfyQUAGsL/Sh1dUadTIyTR9GxoFA8fTIz7stDlhVGjJKJAVApjI4nxg1mdOxvH6782gCwBiM1cXUyt7lb00rSpY1xd+sSQOhnLxOa2CwONW1AI9J4262KZAk0zOnCxMZ8x4JhNfHJNPvx1FFDaLeYDPIZPbgBl6VDEFckCW9ltk/pN2knnj74ukIiom0TpJrWREu+wRCKCUJD13csrFwwItIYNvdz1HL2Gq3x8nO1QAo8vUTjNtbwsU4jSYZl63OAllrx0Jeq6PPWc1hvgGFL8+ZyWAN0RXmOx47PsWD5MbFXtnFKY4hLrFHziG67RV++HJSnjplY2s62z24KZVrOgW7Vel4XaRXq09MivGhSTVmnHU7YUwyHa24O56Jz9GwBAINyfnTpj27WBkH3CECpRcfcyAHMtbDlzZz8PfNabgB0O9CSlI2+EqyXCADR7ZTzn0wACIj0kcsZ6ZNedfkIALoITtZLAOh2xJWrBoDoXi63nukYoNMV++uHKAHo6Ot/qTqlBKyFtjYBUCCMwikAREINnljHdaKHIHGWMgcKwNAejB3smgK3nxTGhQbRk8JAAtjfHyeTqUtQLTgaj6dV4eShfPnqbAoAdjQ+mRkAWaxyotdYhj23WNfzfEEUcKsqsqlLUM3u95yCwI7tE7xWM9c5xG5FFyHZjIB/A7njFJFkTAaA1n7x/f34xsBrWu3/8OAjDFHH9mlNC37bFNITppcfu94ycUHiZp//FXZqo3KyNahjDNEC7brlWIzPhXixQsX/q3JxRpf+ILQCbB3wtyG3bOEey9AoYtniMB76RJbfzdYPoV8/G9bITiOzpi0798B/NMfNgP/Dia3/SIVWvG80i00vKxj2tYeExh+yVEMFhBy+y9DJmYZKgKK/aRmID9JNpyC8yPF+ClDmC9YasTak8F2su28ohP4qtQ9g+Uq925l90xig1OhcehqdEnN0O3uxASBtF+LbGQB0xfgPc2sAdJE8EkcA5p051g47pZMV75OsMGa0eDcDYAsMUMQGsMaI5J4CUBkIFwHrWOpw20FZRHfhFhg7CoBqpKqAPkX8JlwU7o7g+sjclwAQFiP1PukGCuSDOCcUx75Ufh/kFIpgXPzpeffi0ZE5dMFF8PQn9qMjACg782K3BIBPXvh9wYr3MUFyYgr3j17xAoqyPBuMa5/AQcBr4f9sCxEsYbLwt+LNG/BGMB6dl0ttc4h6CO4GXAJAnZmbeatqoY9FbU95ez3XiFr+o8mOL1H5O9OoiECXuZN9AAAAAElFTkSuQmCC';

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
type CrowMode = 'grounded' | 'walking' | 'hopping';

const CROW_ANIMS: Record<CrowAnimation, { row: number; frames: number; duration: number }> = {
    idle: { row: 0, frames: 8, duration: 220 },
    walk: { row: 1, frames: 8, duration: 110 },
    run: { row: 2, frames: 8, duration: 70 },
    peck: { row: 3, frames: 8, duration: 150 },
    takeoff: { row: 4, frames: 8, duration: 90 },
    landing: { row: 5, frames: 8, duration: 90 },
    flight: { row: 6, frames: 8, duration: 80 },
    glide: { row: 7, frames: 8, duration: 140 },
};

const CROW_COLUMNS = 8;
const CROW_ROWS = 8;
/** 2x the native 20 px frame. The scene reads as pixel art at this size. */
const CROW_SIZE = 40;
const CROW_HALF = CROW_SIZE / 2;
/** Clear of the world edge by half a crow plus a little air. */
const CROW_EDGE = CROW_HALF + 10;
/** The crow's feet sit 17 of 20 rows down the frame, so this drops them on the soil. */
const CROW_FOOT = 14;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function mountCrowNPC(layer: HTMLElement) {
    const crow = layer.createEl('button', {
        cls: 'garden-pet garden-pet-crow',
        attr: {
            type: 'button',
            'aria-label': 'Crow. Tap to make it walk. Hold to make it hop.',
        },
    });
    crow.style.setProperty('--crow-atlas', 'url("' + CROW_ATLAS_URL + '")');
    // Keep sprite scale self-contained so stale CSS can never shrink or mis-crop it.
    crow.style.width = CROW_SIZE + 'px';
    crow.style.height = CROW_SIZE + 'px';
    crow.style.backgroundSize =
        (CROW_SIZE * CROW_COLUMNS) + 'px ' + (CROW_SIZE * CROW_ROWS) + 'px';
    crow.style.backgroundRepeat = 'no-repeat';
    crow.style.imageRendering = 'pixelated';

    const world = layer.parentElement ?? layer;
    const viewport = world.parentElement;
    const worldWidth = () => Math.max(600, layer.clientWidth || world.clientWidth || 600);
    const sky = () => Number.parseFloat(getComputedStyle(world).getPropertyValue('--sky')) || 620;
    const groundY = () => sky() - CROW_FOOT;

    /**
     * Where the crow is allowed to wander, in world pixels.
     *
     * The world is far wider than the slice of it the camera shows, so roaming
     * the full width walked the crow off screen for minutes at a time. These
     * bounds are the visible slice, measured back through the camera's own
     * transform, so the crow keeps to the garden being looked at.
     */
    const roamBounds = () => {
        const width = worldWidth();
        const fallback = { min: CROW_EDGE, max: Math.max(CROW_EDGE, width - CROW_EDGE) };
        if (!viewport) return fallback;

        const worldRect = world.getBoundingClientRect();
        const viewRect = viewport.getBoundingClientRect();
        const scale = worldRect.width / (world.offsetWidth || width);
        if (!(scale > 0) || !(viewRect.width > 0)) return fallback;

        const min = Math.max(fallback.min, (viewRect.left - worldRect.left) / scale + CROW_EDGE);
        const max = Math.min(fallback.max, (viewRect.right - worldRect.left) / scale - CROW_EDGE);
        return max > min ? { min, max } : fallback;
    };

    const intoBounds = (value: number) => {
        const { min, max } = roamBounds();
        return clamp(value, min, max);
    };

    let mode: CrowMode = 'grounded';
    let animation: CrowAnimation = 'idle';
    let frame = 0;
    let direction = 1;
    // The world's middle is the middle plant, so this starts the crow beside the
    // garden rather than out in the padding where the camera never looks.
    let x = clamp(worldWidth() / 2 + 70, CROW_EDGE, worldWidth() - CROW_EDGE);
    let y = groundY();

    let animationTimer: number | null = null;
    let animationToken = 0;
    let movementRAF: number | null = null;
    let movementToken = 0;
    let idleTimer: number | null = null;
    let holdTimer: number | null = null;
    let press: { x: number; y: number; at: number } | null = null;
    let held = false;

    const connected = () => crow.isConnected;

    const place = (nextX: number, nextY: number) => {
        x = Math.round(nextX);
        y = Math.round(nextY);
        crow.style.transform =
            'translate3d(' + (x - CROW_HALF) + 'px,' + (y - CROW_HALF) + 'px,0)';
    };

    const face = (nextDirection: number) => {
        direction = nextDirection >= 0 ? 1 : -1;
        crow.toggleClass('is-flipped', direction < 0);
    };

    const draw = () => {
        const spec = CROW_ANIMS[animation];
        crow.style.backgroundPosition =
            (-frame * CROW_SIZE) + 'px ' + (-spec.row * CROW_SIZE) + 'px';
        crow.dataset.state = mode;
    };

    const stopAnimation = () => {
        animationToken++;
        if (animationTimer !== null) window.clearTimeout(animationTimer);
        animationTimer = null;
    };

    const play = (name: CrowAnimation) => {
        stopAnimation();
        animation = name;
        frame = 0;
        draw();

        const token = animationToken;
        const spec = CROW_ANIMS[name];

        const step = () => {
            if (!connected() || token !== animationToken) return;
            frame = (frame + 1) % spec.frames;
            draw();
            animationTimer = window.setTimeout(step, spec.duration);
        };

        animationTimer = window.setTimeout(step, spec.duration);
    };

    const stopMovement = () => {
        movementToken++;
        if (movementRAF !== null) cancelAnimationFrame(movementRAF);
        movementRAF = null;
    };

    const clearGroundTimer = () => {
        if (idleTimer !== null) window.clearTimeout(idleTimer);
        idleTimer = null;
    };

    const scheduleGroundLife = () => {
        clearGroundTimer();
        idleTimer = window.setTimeout(() => {
            if (!connected() || mode !== 'grounded') return;
            if (Math.random() < 0.72) walk();
            else hop();
        }, 2200 + Math.random() * 3400);
    };

    const becomeIdle = () => {
        stopMovement();
        mode = 'grounded';
        place(intoBounds(x), groundY());
        play('idle');
        scheduleGroundLife();
    };

    const walk = (preferredDirection?: number) => {
        if (mode !== 'grounded') return;
        clearGroundTimer();
        mode = 'walking';

        const { min, max } = roamBounds();
        const stride = 28 + Math.random() * 48;
        const sign = preferredDirection
            ? (preferredDirection >= 0 ? 1 : -1)
            : (Math.random() < 0.5 ? -1 : 1);

        let target = clamp(x + sign * stride, min, max);
        if (Math.abs(target - x) < 12) {
            target = clamp(x + (x < (min + max) / 2 ? 1 : -1) * 30, min, max);
        }

        face(target >= x ? 1 : -1);
        play('walk');

        const token = ++movementToken;
        let previous = performance.now();

        const step = (now: number) => {
            if (!connected() || mode !== 'walking' || token !== movementToken) return;
            const dt = Math.min(40, now - previous);
            previous = now;

            const dx = target - x;
            const move = Math.min(Math.abs(dx), 0.028 * dt);
            place(x + Math.sign(dx || direction) * move, groundY());

            if (Math.abs(target - x) <= 1) {
                movementRAF = null;
                becomeIdle();
                return;
            }

            movementRAF = requestAnimationFrame(step);
        };

        movementRAF = requestAnimationFrame(step);
    };

    /** A hop is the walk cycle carried along an arc, so it has no frame of its own to go missing. */
    const hop = () => {
        if (mode !== 'grounded') return;
        clearGroundTimer();
        mode = 'hopping';

        const { min, max } = roamBounds();
        const distance = 12 + Math.random() * 16;
        const target = clamp(x + (Math.random() < 0.5 ? -distance : distance), min, max);
        face(target >= x ? 1 : -1);

        const startX = x;
        const startY = groundY();
        const start = performance.now();
        const duration = CROW_ANIMS.walk.frames * CROW_ANIMS.walk.duration;
        const token = ++movementToken;

        play('walk');

        const step = (now: number) => {
            if (!connected() || mode !== 'hopping' || token !== movementToken) return;
            const t = clamp((now - start) / duration, 0, 1);
            const arc = Math.sin(Math.PI * t) * 8;

            place(startX + (target - startX) * t, startY - arc);

            if (t >= 1) {
                movementRAF = null;
                becomeIdle();
                return;
            }

            movementRAF = requestAnimationFrame(step);
        };

        movementRAF = requestAnimationFrame(step);
    };

    const stopSceneGesture = (e: Event) => e.stopPropagation();
    crow.addEventListener('touchstart', stopSceneGesture, { passive: true });
    crow.addEventListener('touchmove', stopSceneGesture, { passive: true });
    crow.addEventListener('touchend', stopSceneGesture, { passive: true });
    crow.addEventListener('mousedown', stopSceneGesture);

    crow.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    crow.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        crow.setPointerCapture?.(e.pointerId);

        press = { x: e.clientX, y: e.clientY, at: performance.now() };
        held = false;

        if (holdTimer !== null) window.clearTimeout(holdTimer);
        holdTimer = window.setTimeout(() => {
            if (!press || !connected()) return;
            held = true;
            hop();
        }, 520);
    });

    crow.addEventListener('pointermove', (e) => {
        if (!press || holdTimer === null) return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
            window.clearTimeout(holdTimer);
            holdTimer = null;
        }
    });

    crow.addEventListener('pointerup', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (holdTimer !== null) window.clearTimeout(holdTimer);
        holdTimer = null;

        const started = press;
        press = null;
        if (!started || held) return;

        if (
            Math.hypot(e.clientX - started.x, e.clientY - started.y) < 10 &&
            performance.now() - started.at < 520
        ) {
            walk(direction);
        }
    });

    crow.addEventListener('pointercancel', () => {
        if (holdTimer !== null) window.clearTimeout(holdTimer);
        holdTimer = null;
        press = null;
    });

    crow.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        walk(direction);
    });

    place(x, y);
    play('idle');
    // The camera transform is applied after this layer is built, so the first
    // reading of the visible slice has to wait a frame.
    requestAnimationFrame(() => {
        if (connected() && mode === 'grounded') place(intoBounds(x), groundY());
    });
    scheduleGroundLife();

    return {
        walk,
        hop,
        get state() {
            return { mode, animation, frame, direction, x, y };
        },
    };
}
