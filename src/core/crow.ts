import './shim';

/**
 * Exact native-pixel crow atlas generated for cells.garden.
 *
 * 256 × 256 PNG, 8 × 8 cells, each frame 32 × 32 native pixels.
 * Runtime scale is exactly 4× (128 × 128); never interpolate the source art.
 *
 * Rows:
 *   0 idle (4)
 *   1 walk (6)
 *   2 takeoff (6)
 *   3 fly (8)
 *   4 land (6)
 *   5 peck (6)
 *   6 call (4)
 *   7 hop (6)
 */
export const CROW_ATLAS_URL =
    'data:image/png;base64,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';

export const CROW_PREVIEW_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABbUlEQVR4nO2VzU6DQBSFTxsTiRKUv9CfGJI2aXwB48P4Wr6N8QV06aZpggkxUMlQUIKmbhxXg0xL22EguuFbwTDcc++5cwHo6Ojo+Gd6bQRRVIPaoyk03QYAZCnBy+JRKHa/qfjF7IqW7+9uh0VSIu8fyQorqkHXecJVmaUE1zeE21N+vrlfKgEW1B5NQUIUAiT0uH1VYlUIbWI93kTTbWQp4dZEe8+o7YCm27CcMbeWpWTLAVFqH8KlP69MqsqhVhIo2/+RrQAAcRTg6eEecRRwScggNQWWMy7aEEcBlv4cp5oplcDBA8NO/Yl6DgAYupfcc9YSlgAJPeEJAARawILtq1C2ekDAAWMwoZ/5G4BfF3YlwCahNQeMwYSzf1+lMuLADgeYMKt8nSe98mfVMS18H58BAPpf74hWsZQ4UDEFimrQ5PV5KxAX3LQoCT1u9mXEpXHdGa26lqHx77gptWw7VK3vL/6uDR0dbfED34mHkrnn5lQAAAAASUVORK5CYII=';

type CrowAnimation = 'idle' | 'walk' | 'takeoff' | 'fly' | 'land' | 'peck' | 'call';

const CROW_ANIMS: Record<CrowAnimation, { row: number; frames: number; duration: number }> = {
    idle: { row: 0, frames: 4, duration: 220 },
    walk: { row: 1, frames: 6, duration: 110 },
    takeoff: { row: 2, frames: 6, duration: 105 },
    fly: { row: 3, frames: 8, duration: 90 },
    land: { row: 4, frames: 6, duration: 115 },
    peck: { row: 5, frames: 6, duration: 145 },
    call: { row: 6, frames: 4, duration: 170 },
};

type CrowMode = 'grounded' | 'walking' | 'takingoff' | 'flying' | 'landing' | 'calling' | 'pecking';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Mount one lifecycle-safe crow in the garden world.
 *
 * Tap: take off, cross the world, land.
 * Tap while airborne: reverse direction.
 * Hold: call.
 * Idle: occasional peck.
 *
 * All source frames remain 32×32 and are shown at exactly 4× with steps only.
 */
export function mountCrowNPC(layer: HTMLElement) {
    const crow = layer.createEl('button', {
        cls: 'garden-pet garden-pet-crow',
        attr: {
            type: 'button',
            'aria-label': 'Crow. Tap to make it fly. Hold to make it call.',
        },
    });
    crow.style.setProperty('--crow-atlas', 'url("' + CROW_ATLAS_URL + '")');

    const world = layer.parentElement ?? layer;
    const worldWidth = () => Math.max(600, layer.clientWidth || world.clientWidth || 600);
    const sky = () => Number.parseFloat(getComputedStyle(world).getPropertyValue('--sky')) || 620;
    const groundCenterY = () => sky() - 44;
    const airCenterY = () => Math.max(96, sky() * 0.54);

    let mode: CrowMode = 'grounded';
    let animation: CrowAnimation = 'idle';
    let frame = 0;
    let direction = 1;
    let x = clamp(worldWidth() * 0.72, 70, worldWidth() - 70);
    let y = groundCenterY();
    let targetX = x;
    let flightY = airCenterY();
    let animationTimer: number | null = null;
    let animationToken = 0;
    let movementRAF: number | null = null;
    let lastFrame = performance.now();
    let lastAction = performance.now();
    let idleTimer: number | null = null;
    let holdTimer: number | null = null;
    let press: { x: number; y: number; at: number } | null = null;
    let held = false;

    const connected = () => crow.isConnected;

    const place = (nextX: number, nextY: number) => {
        x = nextX;
        y = nextY;
        crow.style.transform = 'translate3d(' + Math.round(x - 64) + 'px,' + Math.round(y - 64) + 'px,0)';
    };

    const face = (nextDirection: number) => {
        direction = nextDirection >= 0 ? 1 : -1;
        crow.toggleClass('is-flipped', direction < 0);
    };

    const draw = () => {
        const spec = CROW_ANIMS[animation];
        crow.style.backgroundPosition = (-frame * 128) + 'px ' + (-spec.row * 128) + 'px';
        crow.dataset.state = mode;
    };

    const stopAnimation = () => {
        animationToken++;
        if (animationTimer !== null) window.clearTimeout(animationTimer);
        animationTimer = null;
    };

    const play = (name: CrowAnimation, once = false, done?: () => void) => {
        stopAnimation();
        animation = name;
        frame = 0;
        draw();
        const token = animationToken;
        const spec = CROW_ANIMS[name];
        const step = () => {
            if (!connected() || token !== animationToken) return;
            frame++;
            if (frame >= spec.frames) {
                if (once) {
                    frame = spec.frames - 1;
                    draw();
                    done?.();
                    return;
                }
                frame = 0;
            }
            draw();
            animationTimer = window.setTimeout(step, spec.duration);
        };
        animationTimer = window.setTimeout(step, spec.duration);
    };

    const stopMovement = () => {
        if (movementRAF !== null) cancelAnimationFrame(movementRAF);
        movementRAF = null;
    };

    const scheduleIdlePeck = () => {
        if (idleTimer !== null) window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
            if (!connected() || mode !== 'grounded') return;
            mode = 'pecking';
            play('peck', true, () => {
                if (!connected()) return;
                mode = 'grounded';
                play('idle');
                scheduleIdlePeck();
            });
        }, 4200 + Math.random() * 3800);
    };

    const becomeIdle = () => {
        stopMovement();
        mode = 'grounded';
        place(clamp(x, 70, worldWidth() - 70), groundCenterY());
        play('idle');
        scheduleIdlePeck();
    };

    const land = () => {
        if (mode !== 'flying') return;
        mode = 'landing';
        const startX = x;
        const startY = y;
        const endX = clamp(x, 70, worldWidth() - 70);
        const endY = groundCenterY();
        const start = performance.now();
        play('land', true, becomeIdle);

        const descend = (now: number) => {
            if (!connected() || mode !== 'landing') return;
            const t = clamp((now - start) / 690, 0, 1);
            const eased = 1 - Math.pow(1 - t, 2);
            place(startX + (endX - startX) * eased, startY + (endY - startY) * eased);
            if (t < 1) movementRAF = requestAnimationFrame(descend);
        };
        stopMovement();
        movementRAF = requestAnimationFrame(descend);
    };

    const flyLoop = (now: number) => {
        if (!connected() || mode !== 'flying') return;
        const dt = Math.min(40, now - lastFrame);
        lastFrame = now;
        const dx = targetX - x;
        const speed = 0.34 * dt;
        place(
            x + Math.sign(dx || direction) * Math.min(Math.abs(dx), speed),
            flightY + Math.sin(now / 235) * 8,
        );
        if (Math.abs(dx) < 8) {
            movementRAF = null;
            land();
            return;
        }
        movementRAF = requestAnimationFrame(flyLoop);
    };

    const startFlying = () => {
        lastAction = performance.now();
        if (idleTimer !== null) window.clearTimeout(idleTimer);

        if (mode === 'flying') {
            face(-direction);
            targetX = direction > 0 ? worldWidth() - 70 : 70;
            return;
        }
        if (mode === 'takingoff' || mode === 'landing') return;

        mode = 'takingoff';
        face(x < worldWidth() / 2 ? 1 : -1);
        targetX = direction > 0 ? worldWidth() - 70 : 70;
        const startX = x;
        const startY = groundCenterY();
        const endY = airCenterY();
        flightY = endY;
        const start = performance.now();

        play('takeoff', true, () => {
            if (!connected() || mode !== 'takingoff') return;
            mode = 'flying';
            lastFrame = performance.now();
            play('fly');
            stopMovement();
            movementRAF = requestAnimationFrame(flyLoop);
        });

        const lift = (now: number) => {
            if (!connected() || mode !== 'takingoff') return;
            const t = clamp((now - start) / 630, 0, 1);
            place(startX + direction * 58 * t, startY + (endY - startY) * t);
            if (t < 1) movementRAF = requestAnimationFrame(lift);
        };
        stopMovement();
        movementRAF = requestAnimationFrame(lift);
    };

    const call = () => {
        if (mode !== 'grounded') return;
        lastAction = performance.now();
        if (idleTimer !== null) window.clearTimeout(idleTimer);
        mode = 'calling';
        play('call', true, becomeIdle);
    };

    // Keep the garden camera/touch adapter from claiming the crow's gesture.
    crow.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    crow.addEventListener('mousedown', (e) => e.stopPropagation());
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
            call();
        }, 520);
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
            startFlying();
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
        startFlying();
    });

    place(x, y);
    play('idle');
    scheduleIdlePeck();

    // Re-anchor after a resize/render-width change without introducing subpixels.
    const onResize = () => {
        if (!connected()) {
            window.removeEventListener('resize', onResize);
            return;
        }
        if (mode === 'grounded') place(clamp(x, 70, worldWidth() - 70), groundCenterY());
    };
    window.addEventListener('resize', onResize);

    return {
        fly: startFlying,
        call,
        get state() {
            return { mode, animation, x, y, lastAction };
        },
    };
}
