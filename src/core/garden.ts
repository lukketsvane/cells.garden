import './shim';
import Sortable, { SortableEvent } from 'sortablejs';
import type { GardenApp } from './app';
import { PLANT_TYPES } from './assets';
import { AddItemModal, ConfirmDeleteModal, CreateProjectModal } from './modals';
import { View } from './ui';
import type { LayerItem, ProjectData, ViewState } from './model';
import {
    simpleHash,
    PIXEL_SCALE, PLANT_SPACING, CLOUD_SCROLL_DURATION,
    STEM_ORIGIN_WIDTH, STEM_ORIGIN_HEIGHT, STEM_OVERLAP_ORIGIN, FIXED_STACK_STEP,
} from './model';

// --- ASSET IMPORTS ---
import bgImageUrl from '../assets/bg_image.png';
import cloudUrl from '../assets/cloud.png';
import mountainsUrl from '../assets/mountains.png';
import groundUrl from '../assets/ground_tile.png';
import starsPatternUrl from '../assets/stars_pattern.gif';
import flower1Url from '../assets/pack/plant_1/flowers/plant_1_flower1.png';
import flower2Url from '../assets/pack/plant_1/flowers/plant_1_flower2.png';

import ant1Url from '../assets/ant_walk_1.png';
import ant2Url from '../assets/ant_walk_2.png';

import stem1Url from '../assets/pack/plant_1/stem/plant_1_part1.png';
import stem2Url from '../assets/pack/plant_1/stem/plant_1_part2.png';
import stem3Url from '../assets/pack/plant_1/stem/plant_1_part3.png';
import stem4Url from '../assets/pack/plant_1/stem/plant_1_part4.png';
import stem5Url from '../assets/pack/plant_1/stem/plant_1_part5.png';
import stem6Url from '../assets/pack/plant_1/stem/plant_1_part6.png';
import stem7Url from '../assets/pack/plant_1/stem/plant_1_part7.png';
import stem8Url from '../assets/pack/plant_1/stem/plant_1_part8.png';

const stemParts: string[] = [
    stem1Url, stem2Url, stem3Url, stem4Url,
    stem5Url, stem6Url, stem7Url, stem8Url
];
// --- 7. The Garden View ---

export class GardenView extends View {
    app: GardenApp;
    private _hasLoadedInitialState = false;
    private _viewStateSaveTimeout: number | null = null;
    
    private isDragging = false;
        // --- Kanban Pan State ---
    private isPanningKanban = false;
    private kanbanStartX = 0;
    private kanbanStartY = 0;
    private kanbanScrollLeft = 0;
    private kanbanScrollTop = 0;
    private startX = 0;
    private startY = 0;
    private currentTranslateX = 0;
    private currentTranslateY = 0;
    private zoom = 1;
    private zoomMin = 0.15; // Changed from 0.3
    private zoomMax = 3;
    private _initialViewApplied: boolean = false;
    private _savedZoom: number | undefined;
    private _savedTranslateX = 0;
    private _savedTranslateY = 0;


    // --- Touch State (Mobile) ---
    private isTouchPanning = false;
    private touchStartX = 0;
    private touchStartY = 0;
    private touchStartTranslateX = 0;
    private touchStartTranslateY = 0;

    private isPinching = false;
    private initialPinchDistance = 0;
    private initialPinchZoom = 1;
    private pinchCenterX = 0;
    private pinchCenterY = 0;
    private pinchWorldX = 0;
    private pinchWorldY = 0;

    // --- Mobile Touch Handlers ---
    private handleTouchStart = (e: TouchEvent) => {
        // Prevent the browser from doing its own scrolling/zooming
        if (e.touches.length > 0) e.preventDefault();

        const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;
        if (!viewport) return;

        if (e.touches.length === 1) {
            // 1 Finger: Start Panning
            this.isTouchPanning = true;
            this.isPinching = false;
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
            this.touchStartTranslateX = this.currentTranslateX;
            this.touchStartTranslateY = this.currentTranslateY;
        } else if (e.touches.length === 2) {
            // 2 Fingers: Start Pinching
            this.isTouchPanning = false;
            this.isPinching = true;
            
            const rect = viewport.getBoundingClientRect();
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            
            this.initialPinchDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            this.initialPinchZoom = this.zoom;
            
            // Calculate center of the two fingers relative to viewport
            this.pinchCenterX = ((t1.clientX + t2.clientX) / 2) - rect.left;
            this.pinchCenterY = ((t1.clientY + t2.clientY) / 2) - rect.top;
            
            // Calculate the world coordinates currently under the pinch center
            this.pinchWorldX = (this.pinchCenterX - this.currentTranslateX) / this.zoom;
            this.pinchWorldY = (this.pinchCenterY - this.currentTranslateY) / this.zoom;
        }
    };

    private handleTouchMove = (e: TouchEvent) => {
        if (e.touches.length > 0) e.preventDefault(); // Prevent page scroll

        const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;
        const world = this.containerEl.querySelector('.garden-world') as HTMLElement | null;
        if (!viewport || !world) return;

        if (this.isTouchPanning && e.touches.length === 1) {
            // 1 Finger Move: Pan
            const dx = e.touches[0].clientX - this.touchStartX;
            const dy = e.touches[0].clientY - this.touchStartY;
            this.currentTranslateX = this.touchStartTranslateX + dx;
            this.currentTranslateY = this.touchStartTranslateY + dy;
            this.applyWorldTransform(world, viewport);
        } else if (this.isPinching && e.touches.length === 2) {
            // 2 Fingers Move: Pinch Zoom
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            
            if (this.initialPinchDistance > 0) {
                let newZoom = this.initialPinchZoom * (currentDist / this.initialPinchDistance);
                newZoom = Math.max(this.zoomMin, Math.min(this.zoomMax, newZoom));
                
                // Adjust translate to keep the pinch center stationary (just like scroll wheel zoom)
                this.currentTranslateX = this.pinchCenterX - (this.pinchWorldX * newZoom);
                this.currentTranslateY = this.pinchCenterY - (this.pinchWorldY * newZoom);
                this.zoom = newZoom;
                
                this.applyWorldTransform(world, viewport);
            }
        }
    };

    private handleTouchEnd = (e: TouchEvent) => {
        // If all fingers are lifted, stop everything and save the view state
        if (e.touches.length === 0) {
            this.isTouchPanning = false;
            this.isPinching = false;
            this.scheduleViewStateSave();
        } else if (e.touches.length === 1 && this.isPinching) {
            // Transitioned from 2 fingers to 1 finger: start panning from the remaining finger
            this.isPinching = false;
            this.isTouchPanning = true;
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
            this.touchStartTranslateX = this.currentTranslateX;
            this.touchStartTranslateY = this.currentTranslateY;
        }
    };

    // --- View State ---

    // Camera + kanban scroll are per surface (web, newtab, sidepanel): a camera saved from a
    // wide New Tab page would leave the world off-screen in a 360px side panel. Kept in
    // localStorage on this device only, never in the synced garden blob.
    private _viewStateKey = 'cells.garden/view/' + (document.documentElement.dataset.context || 'web');

    private saveViewState() {
        const scrollContainer = this.contentEl.querySelector('.kanban-scroll-container') as HTMLElement | null;
        const state: ViewState = {
            zoom: this.zoom,
            translateX: this.currentTranslateX,
            translateY: this.currentTranslateY,
            kanbanScrollLeft: scrollContainer ? scrollContainer.scrollLeft : 0,
            kanbanScrollTop: scrollContainer ? scrollContainer.scrollTop : 0
        };
        try {
            localStorage.setItem(this._viewStateKey, JSON.stringify(state));
        } catch {
            // private mode or blocked storage: the camera just starts centred next time
        } 
    }
    private scheduleViewStateSave() {
        if (this._viewStateSaveTimeout) clearTimeout(this._viewStateSaveTimeout);
        this._viewStateSaveTimeout = window.setTimeout(() => {
            this.saveViewState();
        }, 1000); // Wait 1 second after the last movement before saving to disk
    }
    /** Flush a pending debounced save immediately (tab closing, unmount). */
    saveViewStateNow() {
        if (this._viewStateSaveTimeout) clearTimeout(this._viewStateSaveTimeout);
        this._viewStateSaveTimeout = null;
        this.saveViewState();
    }
    private loadViewState(): ViewState | null {
        try {
            const raw = localStorage.getItem(this._viewStateKey);
            if (!raw) return null;
            const s = JSON.parse(raw) as Partial<ViewState>;
            if (typeof s.zoom !== 'number' || typeof s.translateX !== 'number' || typeof s.translateY !== 'number') return null;
            return {
                zoom: s.zoom,
                translateX: s.translateX,
                translateY: s.translateY,
                kanbanScrollLeft: s.kanbanScrollLeft ?? 0,
                kanbanScrollTop: s.kanbanScrollTop ?? 0,
            };
        } catch {
            return null;
        }
    }

    /** True when the current camera still shows part of the world in this viewport. */
    private cameraInView(): boolean {
        const viewport = this.contentEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;
        const world = this.contentEl.querySelector('.garden-world') as HTMLElement | null;
        if (!viewport || !world) return true;
        const vw = viewport.offsetWidth, vh = viewport.offsetHeight;
        const left = this.currentTranslateX, top = this.currentTranslateY;
        const right = left + world.offsetWidth * this.zoom;
        const bottom = top + world.offsetHeight * this.zoom;
        const margin = 40;
        return right > margin && left < vw - margin && bottom > margin && top < vh - margin;
    }



    
    // --- Shooting Star State ---
    private shootingStarCanvas: HTMLCanvasElement | null = null;
    private shootingStars: { x: number; y: number; angle: number; speed: number; life: number; maxLife: number; history: {x: number, y: number}[] }[] = [];
    private showerAngle: number = Math.PI / 4;
    private showerRemaining: number = 0;
    private satellites: { el: HTMLElement; x: number; y: number; vx: number; vy: number; isUfo: boolean; turnTimer: number }[] = [];
    private satelliteLayer: HTMLElement | null = null;    private shootingStarRAF: number | null = null;
    private nextShootingStarCheck: number = 0;
    private shootingStarsActiveTonight: boolean = true;
    private nightSkyState: 'unrolled' | 'dead' | 'normal' | 'shower' = 'unrolled';

    private startShootingStars() {
        if (this.shootingStarRAF !== null) return;
        const win = this.containerEl.ownerDocument.defaultView || window;

        const spawnStar = () => {
            this.shootingStars.push({
                x: Math.random() * this.shootingStarCanvas!.width,
                y: Math.random() * this.shootingStarCanvas!.height * 0.5, 
                angle: Math.random() * Math.PI * 2, // Random angle for normal stars
                speed: 4 + Math.random() * 2,
                life: 25, // Increased life to allow for fade in/out time
                maxLife: 25,
                history: [] // Initialize empty history for the trail!
            });
        };

        const spawnSatellite = () => {
            if (!this.satelliteLayer) return;
            const satEl = this.satelliteLayer.createDiv();
            const satSize = 1 * PIXEL_SCALE;
            satEl.style.cssText = `
                position: absolute;
                width: ${satSize}px;
                height: ${satSize}px;
                background-color: rgba(255, 255, 255, 0.65);
                pointer-events: none;
                z-index: 6;
                image-rendering: pixelated;
            `;

            const worldW = this.satelliteLayer.offsetWidth;
            const worldH = this.satelliteLayer.offsetHeight;
            
            const isUfo = Math.random() < 0.2; // 20% chance for a UFO!
            const startX = Math.random() < 0.5 ? 0 : worldW;
            const startY = Math.random() * worldH * 0.8;
            
            let angle;
            if (isUfo) {
                angle = Math.random() * Math.PI * 2;
            } else {
                angle = startX < 0 ? Math.random() * Math.PI : Math.PI + (Math.random() * Math.PI);
            }
            
            // Speeds are in 4x world space now (so 0.8 is equivalent to old 0.2)
            const speed = isUfo ? 1.0 + Math.random() * 0.5 : 0.6 + Math.random() * 0.4; 
            
            this.satellites.push({
                el: satEl,
                x: startX,
                y: startY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                isUfo,
                turnTimer: 0
            });
        };

                const animate = (time: number) => {
            const ctx = this.shootingStarCanvas?.getContext('2d');
            if (!ctx || !this.shootingStarCanvas) {
                this.nextShootingStarCheck = time + 5000; 
                this.shootingStarRAF = win.requestAnimationFrame(animate);
                return;
            }

            // Get current sky state to calculate fade alpha
            const state = this.getDayNightState();
            // starOpacity is 0 to 0.35. Scale it to 0 to 1 for full brightness.
            const fadeAlpha = Math.min(1, state.starOpacity * 3);

            // 1. Clear the star canvas completely every frame
            ctx.clearRect(0, 0, this.shootingStarCanvas.width, this.shootingStarCanvas.height);

            // Apply global alpha to all canvas drawings (shooting stars)
            ctx.globalAlpha = fadeAlpha;

            // 2. Spawning Logic
            if (time > this.nextShootingStarCheck) {
                if (state.starOpacity > 0.1 && this.nightSkyState === 'unrolled') {
                    const roll = Math.random();
                    if (roll < 0.15) this.nightSkyState = 'shower';
                    else if (roll < 0.30) this.nightSkyState = 'dead';
                    else this.nightSkyState = 'normal';
                } else if (state.starOpacity <= 0.1) {
                    this.nightSkyState = 'unrolled';
                }

                if (state.starOpacity > 0.1 && this.nightSkyState !== 'unrolled') {
                    if (Math.random() < 0.25) {
                        spawnSatellite();
                        this.nextShootingStarCheck = time + 15000 + Math.random() * 15000; 
                    } else {
                        if (this.nightSkyState === 'shower') {
                            if (this.showerRemaining <= 0) {
                                this.showerRemaining = 2 + Math.floor(Math.random() * 3); 
                                this.showerAngle = Math.PI / 4 + (Math.random() - 0.5) * Math.PI / 2; 
                                this.nextShootingStarCheck = time + 1000 + Math.random() * 2000; 
                            } else {
                                const angleVariance = (Math.random() - 0.5) * 0.52; 
                                const starAngle = this.showerAngle + angleVariance;
                                
                                this.shootingStars.push({
                                    x: Math.random() * this.shootingStarCanvas!.width,
                                    y: Math.random() * this.shootingStarCanvas!.height * 0.5, 
                                    angle: starAngle,
                                    speed: 4 + Math.random() * 2,
                                    life: 25, // Updated to match normal stars
                                    maxLife: 25,
                                    history: [] // <--- ADD THIS!
                                });
                                
                                this.showerRemaining--;
                                if (this.showerRemaining > 0) {
                                    this.nextShootingStarCheck = time + 300 + Math.random() * 500; 
                                } else {
                                    this.nextShootingStarCheck = time + 5000 + Math.random() * 5000; 
                                }
                            }
                        } else if (this.nightSkyState === 'normal') {
                            this.nextShootingStarCheck = time + 30000 + Math.random() * 60000; 
                            spawnStar();
                            if (Math.random() < 0.3) spawnStar(); 
                        } else {
                            this.nextShootingStarCheck = time + 30000; 
                        }
                    }
                } else {
                    this.nextShootingStarCheck = time + 10000; 
                }
            }

            // 3. Draw and Update Shooting Stars (Canvas)
            ctx.lineWidth = 1; 
            ctx.lineCap = 'square';

            for (let i = this.shootingStars.length - 1; i >= 0; i--) {
                const s = this.shootingStars[i];
                const vx = Math.cos(s.angle) * s.speed;
                const vy = Math.sin(s.angle) * s.speed;

                // 1. Calculate smooth sine-wave fade (0 to 1 to 0 over lifespan)
                const progress = 1 - (s.life / s.maxLife); // 0.0 to 1.0
                const fadeAlpha = Math.sin(progress * Math.PI) * 0.55; // Peaks at 0.55 in the middle!

                // 2. Draw a perfect, straight 1-pixel line trail
                const tailDist = 10; // 10px in 1x space (40px on screen)
                // Normalize by speed so the tail length is perfectly consistent
                const tailX = s.x - (vx / s.speed) * tailDist; 
                const tailY = s.y - (vy / s.speed) * tailDist;
                
                const gradient = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${fadeAlpha})`); // Head brightness
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Tail fades to 0
                
                ctx.strokeStyle = gradient;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(tailX, tailY);
                ctx.stroke();

                // Move forward
                s.x += vx;
                s.y += vy;
                s.life--;

                // Remove if dead or off-screen
                if (s.life <= 0 || s.x > this.shootingStarCanvas.width + 10 || s.x < -10 || s.y > this.shootingStarCanvas.height + 10 || s.y < -10) {
                    this.shootingStars.splice(i, 1);
                }
            }
            
            // Reset global alpha so we don't accidentally affect anything else
            ctx.globalAlpha = 1;

            // 4. Update Satellites (DOM)
            for (let i = this.satellites.length - 1; i >= 0; i--) {
                const s = this.satellites[i];
                
                if (s.isUfo && time > s.turnTimer) {
                    s.turnTimer = time + 1000 + Math.random() * 2000; 
                    const newAngle = Math.random() * Math.PI * 2;
                    const currentSpeed = Math.sqrt(s.vx*s.vx + s.vy*s.vy);
                    s.vx = Math.cos(newAngle) * currentSpeed;
                    s.vy = Math.sin(newAngle) * currentSpeed;
                }

                s.x += s.vx;
                s.y += s.vy;
                
                // Apply the fade alpha to the DOM element as well!
                s.el.style.opacity = String(fadeAlpha);
                s.el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`;

                const worldW = this.satelliteLayer?.offsetWidth || 800;
                const worldH = this.satelliteLayer?.offsetHeight || 600;

                // Remove as soon as they cross the world edge
                if (s.x < -5 || s.x > worldW + 5 || s.y < -5 || s.y > worldH + 5) {
                    s.el.remove();
                    this.satellites.splice(i, 1);
                }
            }

            this.shootingStarRAF = win.requestAnimationFrame(animate);
        };

        this.shootingStarRAF = win.requestAnimationFrame(animate);
    }

    private stopShootingStars() {
        if (this.shootingStarRAF !== null) {
            const win = this.containerEl.ownerDocument.defaultView || window;
            win.cancelAnimationFrame(this.shootingStarRAF);
            this.shootingStarRAF = null;
        }
        if (this.shootingStarCanvas) {
            const ctx = this.shootingStarCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, this.shootingStarCanvas.width, this.shootingStarCanvas.height);
        }
        this.shootingStars = [];
        
        this.satellites.forEach(s => s.el.remove());
        this.satellites = [];
    }

    // --- Ant State ---
    private antX: number = 50;
    private antDirection: number = 1;
    private antFrame: number = 0;
    private antWalkInterval: number | null = null;
    private antBreakTimeout: number | null = null;
    private antTurnTimeout: number | null = null;
    private isWalking: boolean = false;
    private antInitialized: boolean = false;

    // --- Worm State ---
    private wormSegments: { x: number; y: number }[] = [];
    private wormDir: { x: number; y: number } = { x: 1, y: 0 };
    private wormNextDir: { x: number; y: number } = { x: 1, y: 0 };
    private wormInterval: number | null = null;
    private wormTurnTimeout: number | null = null;
    private wormBreakTimeout: number | null = null;
    private wormElRefs: HTMLElement[] = [];
    private wormPixelSize = 4;
    private wormSpeed = 960; // ms per tick (1/3 of current speed)
    private wormTrailCanvas: HTMLCanvasElement | null = null;
    private wormIsRunning = false;
    private wormHitboxEl: HTMLElement | null = null;
    private _savedWormSegments: { x: number; y: number }[] | null = null;
    private _savedWormDir: { x: number; y: number } | null = null;
    private _savedWormNextDir: { x: number; y: number } | null = null;
    private _dynamicGroundLineY = 0; // Set during rendering, used by worm bounds
    private _skyUpdateInterval: number | null = null;

    // --- Firefly State ---
    private fireflyState: {
        el: HTMLElement;
        cx: number; cy: number; 
        vx: number; vy: number; 
        rx: number; ry: number; 
        drx: number; dry: number; // Radius velocities for morphing loops!
        spX: number; spY: number; 
        phase: number;
        isLanded: boolean;
        landedUntil: number;
        landedX: number;
        landedY: number;
    }[] = [];
    private fireflyRAF: number | null = null;
    private fireflySkyHeight: number = 0;

    // --- Drawing Mode State ---

        // Custom pixel-style pencil cursor for drawing mode
    private drawingCursor: string = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>') 2 22, crosshair`;
    private isDrawingMode = false;
    private selectedToolEraser = false; // Tracks which toolbar button is active
    private isActivelyErasing = false;  // Tracks what the current mouse stroke is doing
    private isCurrentlyDrawing = false;
    private drawingToolbarEl: HTMLElement | null = null;
    private lastDrawX = 0;
    private lastDrawY = 0;

    // --- The Ant Logic ---
    private startAnt() {
        // Only reset position on the very first call ever, not on re-renders
        if (!this.antInitialized) {
            this.antX = 50;
            this.antDirection = 1;
            this.antInitialized = true;
        }
        this.isWalking = true;

        this.resumeWalking();
        this.scheduleAntBreak();
    }

    private resumeWalking() {
        if (this.antWalkInterval) return; // Already walking

        const walkLogic = () => {
            const world = this.containerEl.querySelector('.garden-world') as HTMLElement;
            const worldWidth = world ? world.offsetWidth : 800;
            // Fixed speed (20 pixels per second). No longer scales with world width.
            const speed = 2; 
            this.antX += speed * this.antDirection;
            this.antFrame = this.antFrame === 0 ? 1 : 0;

            if (world) {
                if (this.antX > worldWidth - 30) this.antDirection = -1;
                if (this.antX < 30) this.antDirection = 1;
            }

            const antEl = this.containerEl.querySelector('.garden-ant') as HTMLElement;
            if (antEl) {
                antEl.style.left = `${this.antX}px`;
                antEl.style.transform = this.antDirection === 1 ? 'scaleX(1)' : 'scaleX(-1)';
                const imgUrl = this.antFrame === 0 ? ant1Url : ant2Url;
                antEl.style.backgroundImage = imgUrl ? `url(${imgUrl})` : 'none';
            }
        };

        this.antWalkInterval = window.setInterval(walkLogic, 100);

        // Schedule a random turn while walking (0.5 to 3 seconds)
        this.scheduleRandomTurn();
    }

    private scheduleRandomTurn() {
        if (this.antTurnTimeout) clearTimeout(this.antTurnTimeout);

        const turnTime = 2000 + Math.random() * 4000;
        this.antTurnTimeout = window.setTimeout(() => {
            if (!this.isWalking) return;

            // 25% chance to turn around, 75% chance to keep going
            if (Math.random() < 0.25) {
                this.antDirection *= -1;
            }

            // Schedule the next potential turn
            this.scheduleRandomTurn();
        }, turnTime);
    }

    private stopAnt() {
        this.isWalking = false;
        if (this.antWalkInterval) {
            clearInterval(this.antWalkInterval);
            this.antWalkInterval = null;
        }
        if (this.antBreakTimeout) {
            clearTimeout(this.antBreakTimeout);
            this.antBreakTimeout = null;
        }
        if (this.antTurnTimeout) {
            clearTimeout(this.antTurnTimeout);
            this.antTurnTimeout = null;
        }
    }

    private scheduleAntBreak() {
        if (this.antBreakTimeout) clearTimeout(this.antBreakTimeout);

        // Walk for 4 to 10 seconds before taking a break
        const walkTime = 4000 + Math.random() * 6000;

        this.antBreakTimeout = window.setTimeout(() => {
            // Pause walking
            if (this.antWalkInterval) {
                clearInterval(this.antWalkInterval);
                this.antWalkInterval = null;
            }
            if (this.antTurnTimeout) {
                clearTimeout(this.antTurnTimeout);
                this.antTurnTimeout = null;
            }

            // Stand still for 0.5 to 2 seconds
            const pauseTime = 500 + Math.random() * 1500;
            this.antBreakTimeout = window.setTimeout(() => {
                this.resumeWalking();
                this.scheduleAntBreak(); // Schedule the next break
            }, pauseTime);
        }, walkTime);
    }

    // --- The Worm Logic ---
    private startWorm() {
        this.stopWorm();



        
        const world = this.containerEl.querySelector('.garden-world') as HTMLElement;
        if (!world) return;

        const seg = this.wormPixelSize;

        // Restore saved worm state if available (preserves position across re-renders)
        if (this._savedWormSegments && this._savedWormSegments.length === 7) {
            this.wormSegments = this._savedWormSegments.map(s => ({ ...s }));
            this.wormDir = this._savedWormDir ? { ...this._savedWormDir } : { x: 1, y: 0 };
            this.wormNextDir = this._savedWormNextDir ? { ...this._savedWormNextDir } : { x: 1, y: 0 };
            // Clamp restored positions to underground area (layout may have changed)
            const worldW = world.offsetWidth;
            const worldH = world.offsetHeight;
            const glY = this._dynamicGroundLineY;
            for (const s of this.wormSegments) {
                if (s.y < glY + seg) s.y = glY + seg;
                if (s.y + seg > worldH) s.y = worldH - seg * 2;
                if (s.x < 0) s.x = 0;
                if (s.x + seg > worldW) s.x = worldW - seg;
            }
        } else {
            // First spawn: place in the middle of the underground area
            const worldW = world.offsetWidth;
            const worldH = world.offsetHeight;
            const groundLineY = this._dynamicGroundLineY;
            const startX = Math.floor(worldW / 2 / seg) * seg;
            const startY = Math.floor((groundLineY + (worldH - groundLineY) / 2) / seg) * seg;
            this.wormSegments = [];
            this.wormDir = { x: 1, y: 0 };
            this.wormNextDir = { x: 1, y: 0 };
            for (let i = 0; i < 7; i++) {
                this.wormSegments.push({ x: startX - i * seg, y: startY });
            }
        }

        // Set initial positions on the DOM elements immediately (no flash at 0,0)
        this.wormElRefs.forEach((el, i) => {
            if (this.wormSegments[i]) {
                el.style.left = `${this.wormSegments[i].x}px`;
                el.style.top = `${this.wormSegments[i].y}px`;
            }
        });
        this.updateWormHitbox();

        this.wormIsRunning = true;
        this.resumeWorm();
        this.scheduleWormTurn();
        this.scheduleWormBreak();
    }

    private resumeWorm() {
        if (this.wormInterval) return;

        const moveLogic = () => {
            const world = this.containerEl.querySelector('.garden-world') as HTMLElement;
            if (!world) return;

            const worldW = world.offsetWidth;
            const worldH = world.offsetHeight;
            const groundLineY = this._dynamicGroundLineY;
            const seg = this.wormPixelSize;

            // Apply queued direction (prevents 180° turns)
            this.wormDir = { ...this.wormNextDir };

            // Calculate new head position
            const head = this.wormSegments[0];
            let newX = head.x + this.wormDir.x * seg;
            let newY = head.y + this.wormDir.y * seg;

            // Bounce off underground boundaries (ground line at top, world bottom)
            if (newX < 0 || newX >= worldW) {
                this.wormDir.x *= -1;
                this.wormNextDir.x *= -1;
                newX = head.x + this.wormDir.x * seg;
            }
            if (newY < groundLineY || newY >= worldH) {
                this.wormDir.y *= -1;
                this.wormNextDir.y *= -1;
                newY = head.y + this.wormDir.y * seg;
            }

            // Record old tail position for the trail
            const oldTail = this.wormSegments[this.wormSegments.length - 1];

            // Move: each segment takes the position of the one ahead of it
            for (let i = this.wormSegments.length - 1; i > 0; i--) {
                this.wormSegments[i] = { ...this.wormSegments[i - 1] };
            }
            this.wormSegments[0] = { x: newX, y: newY };

            // Draw trail pixel on canvas (dirt tunnel effect)
            // Canvas is ground-only, so offset Y by groundLineY
            if (this.wormTrailCanvas) {
                const ctx = this.wormTrailCanvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
                    ctx.fillRect(oldTail.x, oldTail.y - groundLineY, seg, seg);
                }
            }

            // Update DOM
            this.wormElRefs.forEach((el, i) => {
                if (this.wormSegments[i]) {
                    el.style.left = `${this.wormSegments[i].x}px`;
                    el.style.top = `${this.wormSegments[i].y}px`;
                }
            });
            this.updateWormHitbox();
        };

        this.wormInterval = window.setInterval(moveLogic, this.wormSpeed);
    }

    private pauseWorm() {
        if (this.wormInterval) {
            clearInterval(this.wormInterval);
            this.wormInterval = null;
        }
        if (this.wormTurnTimeout) {
            clearTimeout(this.wormTurnTimeout);
            this.wormTurnTimeout = null;
        }
    }

    private scheduleWormTurn() {
        if (this.wormTurnTimeout) clearTimeout(this.wormTurnTimeout);

        const turnTime = 1000 + Math.random() * 4000;
        this.wormTurnTimeout = window.setTimeout(() => {
            if (!this.wormIsRunning) return;

            // Pick a random direction that isn't a 180° reversal
            const dirs = [
                { x: 0, y: -1 }, // up
                { x: 0, y: 1 },  // down
                { x: -1, y: 0 }, // left
                { x: 1, y: 0 },  // right
            ];
            const validDirs = dirs.filter(d => !(d.x === -this.wormDir.x && d.y === -this.wormDir.y));
            const chosen = validDirs[Math.floor(Math.random() * validDirs.length)];
            this.wormNextDir = chosen;

            this.scheduleWormTurn();
        }, turnTime);
    }

    private scheduleWormBreak() {
        if (this.wormBreakTimeout) clearTimeout(this.wormBreakTimeout);

        const moveTime = 4000 + Math.random() * 8000;
        this.wormBreakTimeout = window.setTimeout(() => {
            this.pauseWorm();

            const pauseTime = 3000 + Math.random() * 6000;
            this.wormBreakTimeout = window.setTimeout(() => {
                this.resumeWorm();
                this.scheduleWormTurn();
                this.scheduleWormBreak();
            }, pauseTime);
        }, moveTime);
    }

    private stopWorm() {
        this.wormIsRunning = false;
        // Save worm state before stopping (for preservation across re-renders)
        if (this.wormSegments.length > 0) {
            this._savedWormSegments = this.wormSegments.map(s => ({ ...s }));
            this._savedWormDir = { ...this.wormDir };
            this._savedWormNextDir = { ...this.wormNextDir };
        }
        this.pauseWorm();
        if (this.wormBreakTimeout) {
            clearTimeout(this.wormBreakTimeout);
            this.wormBreakTimeout = null;
        }
    }

    private createWormElements(parent: HTMLElement) {
        const seg = this.wormPixelSize;
        this.wormElRefs = [];

        // --- Single hitbox for unified hover and click ---
        const hitbox = parent.createDiv("garden-worm-hitbox");
        hitbox.style.cssText = `
            position: absolute; z-index: 2; pointer-events: auto; cursor: pointer;
        `;
        hitbox.addEventListener('click', (e) => {
            e.stopPropagation();
            this.enterDrawingMode();
        });
        hitbox.addEventListener('mouseenter', () => {
            parent.classList.add('garden-worm-pulsing');
        });
        hitbox.addEventListener('mouseleave', () => {
            parent.classList.remove('garden-worm-pulsing');
        });
        this.wormHitboxEl = hitbox;


        // --- Worm body segments (visual only, no interactions) ---
        const colors = ['#382c38', '#312b31'];
        for (let i = 0; i < 7; i++) {
            const el = parent.createDiv("garden-worm-segment");
            el.style.position = 'absolute';
            el.style.width = `${seg}px`;
            el.style.height = `${seg}px`;
            el.style.imageRendering = 'pixelated';
            el.style.zIndex = '1';
            el.style.backgroundColor = colors[i % 2];
            el.style.pointerEvents = 'none';
            this.wormElRefs.push(el);
        }
    }


    // --- The Firefly Logic ---
    private createFireflies(parent: HTMLElement, skyHeight: number) {
        this.fireflySkyHeight = skyHeight;
        this.fireflyState = [];
        parent.empty();

        // Inject blink keyframe if not present
        if (!document.getElementById('garden-firefly-keyframes')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'garden-firefly-keyframes';
            styleEl.textContent = `
                @keyframes garden-firefly-blink {
                    0%, 100% { filter: brightness(0.8); box-shadow: 0 0 4px 1px rgba(126, 179, 87, var(--glow-opacity, 0)); }
                    50% { filter: brightness(1.2); box-shadow: 0 0 6px 2px rgba(126, 179, 87, var(--glow-opacity, 0)); }
                }
            `;
            document.head.appendChild(styleEl);
        }

        const count = 8;
        const fireflySize = 1 * PIXEL_SCALE;

        for (let i = 0; i < count; i++) {
            const el = parent.createDiv("garden-firefly");
            el.style.cssText = `
                position: absolute;
                width: ${fireflySize}px;
                height: ${fireflySize}px;
                background-color: var(--firefly-color, #5e7e50);
                pointer-events: none;
                z-index: 6;
                image-rendering: pixelated;
                transition: background-color 30s ease, opacity 2s ease-in;
                opacity: 0;
                will-change: transform, opacity;
            `;

            const cx = Math.random() * parent.offsetWidth;
            const minStartY = Math.max(10, skyHeight - 100);
            const maxStartY = skyHeight - 10;
            const cy = minStartY + (Math.random() * (maxStartY - minStartY));

            // Drift speed reduced to 1/4 (very slow meandering)
            const vx = (Math.random() - 0.5) * 0.2; 
            const vy = (Math.random() - 0.5) * 0.1;

            // Starting radii
            const rx = 15 + Math.random() * 30;
            const ry = 10 + Math.random() * 25;

            // Starting radius velocities (so the loops constantly morph over time)
            const drx = (Math.random() - 0.5) * 0.05;
            const dry = (Math.random() - 0.5) * 0.05;

            // Orbit speed reduced to 1/4 (very lazy looping)
            const spX = 0.00025 + Math.random() * 0.00075;
            const spY = 0.00025 + Math.random() * 0.00075;

            const phase = Math.random() * Math.PI * 2;

            const blinkDuration = 1.5 + Math.random() * 2.5;
            el.style.animation = `garden-firefly-blink ${blinkDuration}s ease-in-out infinite`;
            
            this.fireflyState.push({ 
                el, cx, cy, vx, vy, rx, ry, drx, dry, spX, spY, phase, 
                isLanded: false, landedUntil: 0, landedX: 0, landedY: 0 
            });
            
            el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
        }
    }

    private startFireflies() {
        if (this.fireflyRAF !== null) return;

        // 1. Fade them in
        for (const f of this.fireflyState) {
            f.el.style.opacity = '1';
        }

        const world = this.containerEl.querySelector('.garden-world') as HTMLElement;
        if (!world) return;

        // Cache plant bounds for landing
        const plantWrappers = Array.from(world.querySelectorAll('.garden-plant-wrapper')) as HTMLElement[];
        const plantBounds = plantWrappers.map(p => {
            if (!p.querySelector('.garden-stem-part, .garden-flower-part')) return null;
            const leftStr = p.style.left;
            const center = leftStr ? parseFloat(leftStr) : 0;
            const width = parseInt(p.dataset.width || '30'); 
            return { left: center - (width / 2), right: center + (width / 2) };
        }).filter(b => b !== null) as { left: number, right: number }[];

        const win = this.containerEl.ownerDocument.defaultView || window;

        const animate = (time: number) => {
            const maxX = world.offsetWidth - 10;
            const minY = this.fireflySkyHeight - 350; 
            const maxY = this.fireflySkyHeight - 5;   

            for (const f of this.fireflyState) {
                // --- LANDED STATE ---
                if (f.isLanded) {
                    if (time < f.landedUntil) {
                        f.el.style.transform = `translate3d(${f.landedX}px, ${f.landedY}px, 0)`;
                        continue; 
                    } else {
                        // Take off!
                        f.isLanded = false;
                        f.cx = f.landedX;
                        f.cy = f.landedY;
                    }
                }

                // --- WANDERING DRIFT CENTER ---
                // Reduced steering force to 1/4 so they turn very slowly
                f.vx += (Math.random() - 0.5) * 0.0125;
                f.vy += (Math.random() - 0.5) * 0.0125;

                // Cap drift speed to 1/4 (0.25)
                const driftSpeed = Math.sqrt(f.vx*f.vx + f.vy*f.vy);
                const maxDrift = 12.25;
                if (driftSpeed > maxDrift) {
                    f.vx = (f.vx / driftSpeed) * maxDrift;
                    f.vy = (f.vy / driftSpeed) * maxDrift;
                }

                f.cx += f.vx;
                f.cy += f.vy;

                // Boundary clamping for the drift center (accounts for loop radius so they never bump the ground!)
                const minCy = minY + f.ry;
                const maxCy = maxY - f.ry;
                if (minCy > maxCy) { f.cy = (minY + maxY) / 2; } // Fallback if area too small
                else { f.cy = Math.max(minCy, Math.min(maxCy, f.cy)); }

                const minCx = 10 + f.rx;
                const maxCx = maxX - f.rx;
                if (minCx > maxCx) { f.cx = (10 + maxX) / 2; }
                else { f.cx = Math.max(minCx, Math.min(maxCx, f.cx)); }

                // --- MORPHING RADII ---
                // Wander the radii velocities so the loop shape constantly changes
                f.drx += (Math.random() - 0.5) * 0.02;
                f.dry += (Math.random() - 0.5) * 0.02;

                // Clamp the radii velocities so they don't spin out of control
                f.drx = Math.max(-0.1, Math.min(0.1, f.drx));
                f.dry = Math.max(-0.1, Math.min(0.1, f.dry));

                // Apply to radii
                f.rx += f.drx;
                f.ry += f.dry;

                // Bounce the radii off min/max bounds so they grow and shrink endlessly
                if (f.rx < 5 || f.rx > 75) f.drx *= -1;
                if (f.ry < 5 || f.ry > 60) f.dry *= -1;

                // --- LISSAJOUS FLUTTER ---
                let x = f.cx + Math.sin(time * f.spX + f.phase) * f.rx;
                let y = f.cy + Math.sin(time * f.spY + f.phase) * f.ry;

                // --- LANDING DETECTION ---
                const isNearGround = y >= this.fireflySkyHeight - 60;
                
                if (isNearGround) {
                    for (const bound of plantBounds) {
                        if (x >= bound.left && x <= bound.right) {
                            if (Math.random() < 0.02) {
                                f.isLanded = true;
                                f.landedX = x;
                                f.landedY = y;
                                f.landedUntil = time + 4000 + Math.random() * 56000;
                                f.el.style.transform = `translate3d(${f.landedX}px, ${f.landedY}px, 0)`;
                                break;
                            }
                        }
                    }
                    if (f.isLanded) continue;
                }

                f.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            }

            this.fireflyRAF = win.requestAnimationFrame(animate);
        };

        this.fireflyRAF = win.requestAnimationFrame(animate);
    }

    private stopFireflies() {
        if (this.fireflyRAF !== null) {
            const win = this.containerEl.ownerDocument.defaultView || window;
            win.cancelAnimationFrame(this.fireflyRAF);
            this.fireflyRAF = null;
        }
    }

    private updateWormHitbox() {
        if (!this.wormHitboxEl || this.wormSegments.length === 0) return;
        const seg = this.wormPixelSize;
        const pad = 2; // padding inside the outline
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of this.wormSegments) {
            if (s.x < minX) minX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.x + seg > maxX) maxX = s.x + seg;
            if (s.y + seg > maxY) maxY = s.y + seg;
        }
        this.wormHitboxEl.style.left = `${minX - pad}px`;
        this.wormHitboxEl.style.top = `${minY - pad}px`;
        this.wormHitboxEl.style.width = `${maxX - minX + pad * 2}px`;
        this.wormHitboxEl.style.height = `${maxY - minY + pad * 2}px`;
    }


    constructor(host: HTMLElement, app: GardenApp) {
        super(host);
        this.app = app;
    }

    private _renderGeneration = 0; // Guards against concurrent onOpen() calls
    private _renderDebounce: ReturnType<typeof setTimeout> | null = null;

    /** Debounced version of onOpen — coalesces rapid calls (e.g. fast cell reorders) */
    scheduleRender() {
        if (this._renderDebounce) clearTimeout(this._renderDebounce);
        const win = this.containerEl.ownerDocument.defaultView || window;
        // Cast to any to bridge the gap between Node's Timeout and Browser's number
        this._renderDebounce = win.setTimeout(() => { this.onOpen(); }, 80) as any;
    }

    async onOpen() {
        const thisGeneration = ++this._renderGeneration;
        try {
            // Stop animations BEFORE destroying the DOM to prevent stale intervals
            this.stopAnt();
            this.stopWorm();
            this.stopFireflies();
            this.stopShootingStars();

            // Only load from hard drive on the very first render (app startup)
            const persistedState = !this._hasLoadedInitialState ? this.loadViewState() : null;
            
            // Save current scroll positions BEFORE destroying the DOM
            const scrollStates = this.saveScrollPositions();
            
            if (persistedState) {
                // App just started: override camera coordinates with saved ones from data.json
                this.zoom = persistedState.zoom;
                this.currentTranslateX = persistedState.translateX;
                this.currentTranslateY = persistedState.translateY;
                scrollStates.selectors = scrollStates.selectors.map(s => {
                    if (s.selector.startsWith('.kanban-scroll-container')) {
                        return { ...s, scrollLeft: persistedState.kanbanScrollLeft, scrollTop: persistedState.kanbanScrollTop };
                    }
                    return s;
                });
            }
            // If no persistedState, we do nothing! this.zoom and this.currentTranslateX naturally persist!


            // Save canvas content before DOM is destroyed
            let savedCanvasImage: string | null = null;
            const oldGroundLineY = this._dynamicGroundLineY;
            if (this.wormTrailCanvas) {
                try { savedCanvasImage = this.wormTrailCanvas.toDataURL(); } catch(_) {}
            }

            const container = this.contentEl;
            if (!container) return;

            container.empty();
            container.addClass("garden-container");
            await this.renderGarden(container);

            // If another onOpen() was triggered while we were rendering, abort this one
            if (this._renderGeneration !== thisGeneration) return;
            // Canvas is now ground-only; offset by old ground line to align content
            if (savedCanvasImage && this.wormTrailCanvas) {
                const img = new Image();
                img.onload = () => {
                    const ctx = this.wormTrailCanvas?.getContext('2d');
                    if (ctx) {
                        // Offset by how much the ground line shifted between renders
                        const yOffset = this._dynamicGroundLineY - oldGroundLineY;
                        ctx.drawImage(img, 0, yOffset);
                    }
                };
                img.src = savedCanvasImage;
            }

            // --- VIEW RESTORATION ---
            if (!this._hasLoadedInitialState) {
                this._hasLoadedInitialState = true; // Mark as done so this only runs once ever!
                
                if (!persistedState || !this.cameraInView()) {
                    // No usable saved state (none, or saved by a surface of another size): centre the view.
                    const win = this.containerEl.ownerDocument.defaultView || window;
                    win.requestAnimationFrame(() => {
                        win.requestAnimationFrame(() => {
                            const viewport = this.contentEl.querySelector('.garden-canvas-viewport') as HTMLElement;
                            const world = this.contentEl.querySelector('.garden-world') as HTMLElement;
                            if (viewport && world) {
                                this.zoom = 0.4;
                                const vpWidth = viewport.offsetWidth || 800;
                                const vpHeight = viewport.offsetHeight || 600;
                                const plantCount = this.app.gardenData.length;
                                const middlePlantIndex = Math.floor(plantCount / 2);
                                const middlePlantWorldX = 320 + (middlePlantIndex * 300) + 150;
                                
                                this.currentTranslateX = (vpWidth / 2) - (middlePlantWorldX * this.zoom);
                                this.currentTranslateY = (vpHeight * 0.65) - (this._dynamicGroundLineY * this.zoom);
                                this.applyWorldTransform(world, viewport);
                            }

                            const scrollContainer = this.contentEl.querySelector('.kanban-scroll-container') as HTMLElement;
                            if (scrollContainer) {
                                scrollContainer.scrollLeft = (scrollContainer.scrollWidth - scrollContainer.clientWidth) / 2;
                                const firstSeed = scrollContainer.querySelector('.seed-cell') as HTMLElement;
                                if (firstSeed) {
                                    const seedCenterY = firstSeed.offsetTop + (firstSeed.offsetHeight / 2);
                                    scrollContainer.scrollTop = seedCenterY - (scrollContainer.clientHeight / 2);
                                }
                            }
                            this.saveViewState();
                        });
                    });
                } else {
                    // We had a saved state, restore the Kanban scroll
                    this.restoreScrollPositions(scrollStates);
                }
            } else {
                // Normal re-render (e.g. adding a plant). Camera stayed still, just restore Kanban scroll.
                this.restoreScrollPositions(scrollStates);
            }
            

            console.log("Garden Cells: Render finished successfully!");
            this.startAnt();
            this.startWorm();
            this.startFireflies();
            this.startShootingStars();
            


        } catch (e: unknown) {
            console.error("GARDEN CELLS CRASH IN ONOPEN:", e);
            const container = this.contentEl;
            if (container) {
                container.createEl("h2", { text: "Garden Crashed" });
                container.createEl("p", { text: String(e) }); // String(e) safely converts unknown to text
            }
        }
    }

    // --- Drawing Mode ---
    private enterDrawingMode() {
        this.isDrawingMode = true;
        this.selectedToolEraser = false;
        this.containerEl.addClass('is-drawing-mode'); 
        const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;
        if (viewport) viewport.addClass('is-drawing'); // ADD CLASS
        this.showDrawingToolbar();

        const vp = viewport;
        if (vp) {
            vp.addEventListener('mousedown', this.handleDrawStart);
            vp.addEventListener('contextmenu', this.preventContextMenu);
        }
    }

    private exitDrawingMode() {
        this.isDrawingMode = false;
        this.isCurrentlyDrawing = false;
        this.containerEl.removeClass('is-drawing-mode');
        const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;
        if (viewport) viewport.removeClass('is-drawing'); // REMOVE CLASS
        
        if (this.drawingToolbarEl) {
            this.drawingToolbarEl.remove();
            this.drawingToolbarEl = null;
        }
        const vp = viewport;
        if (vp) {
            vp.removeEventListener('mousedown', this.handleDrawStart);
            vp.removeEventListener('contextmenu', this.preventContextMenu);
        }
    }

    private handleDrawStart = (e: MouseEvent) => {
        if (!this.isDrawingMode) return;
        // Middle mouse (button 1) pans instead!
        if (e.button === 1) return; 
        
        // Don't draw/erase if clicking on the toolbar
        if ((e.target as HTMLElement).closest('.drawing-toolbar')) return;

        const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;

        if (e.button === 2) {
            // Right click ALWAYS erases, regardless of selected tool
            this.isActivelyErasing = true;
        } else if (e.button === 0) {
            // Left click uses the selected tool
            this.isActivelyErasing = this.selectedToolEraser;
        } else {
            return;
        }

        // Update cursor if we started an erasing stroke with the pencil tool selected
        if (viewport) {
            if (this.isActivelyErasing) viewport.addClass('is-erasing');
            else viewport.removeClass('is-erasing');
        }

        this.isCurrentlyDrawing = true;
        // Draw a dot at the start point
        this.lastDrawX = -1; 
        this.drawOnCanvas(e);
    };

    private preventContextMenu = (e: MouseEvent) => {
        e.preventDefault();
    };

    private screenToCanvasCoords(e: MouseEvent): { x: number; y: number } | null {
        if (!this.wormTrailCanvas) return null;
        const rect = this.wormTrailCanvas.getBoundingClientRect();
        // rect is the CSS-displayed size of the canvas (affected by zoom/pan transform)
        // canvas.width/height is the pixel resolution
        const scaleX = this.wormTrailCanvas.width / rect.width;
        const scaleY = this.wormTrailCanvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    private drawOnCanvas(e: MouseEvent) {
        if (!this.wormTrailCanvas) return;
        const ctx = this.wormTrailCanvas.getContext('2d');
        if (!ctx) return;
        const coords = this.screenToCanvasCoords(e);
        if (!coords) return;

        const brushSize = this.isActivelyErasing ? 32 : 4;

        if (this.isActivelyErasing) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgba(0, 0, 0, 1)'; 
        }

        if (this.isActivelyErasing) {
            // Round eraser: draw a filled circle
            ctx.beginPath();
            ctx.arc(coords.x, coords.y, brushSize / 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.lastDrawX >= 0) {
            // Draw line from last point to current (smooth strokes)
            ctx.lineWidth = brushSize;
            ctx.lineCap = 'square';
            ctx.beginPath();
            ctx.moveTo(this.lastDrawX, this.lastDrawY);
            ctx.lineTo(coords.x, coords.y);
            ctx.stroke();
        } else {
            // First dot
            ctx.fillRect(coords.x - brushSize / 2, coords.y - brushSize / 2, brushSize, brushSize);
        }

        this.lastDrawX = coords.x;
        this.lastDrawY = coords.y;

        // Reset composite operation
        ctx.globalCompositeOperation = 'source-over';
    }

    private showDrawingToolbar() {
        // Remove old toolbar if exists
        if (this.drawingToolbarEl) {
            this.drawingToolbarEl.remove();
        }

        const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement;
        if (!viewport) return;

        const toolbar = document.createElement('div');
        toolbar.className = 'drawing-toolbar';
        toolbar.style.cssText = `
            position: absolute; top: 8px; right: 8px; z-index: 100;
            display: flex; flex-direction: column; align-items: center; gap: 4px;
            background: rgba(0,0,0,0.6); border-radius: 6px; padding: 4px;
        `;
        this.drawingToolbarEl = toolbar;

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 4px;';

        // Pen button
        const penBtn = document.createElement('button');
        penBtn.className = 'drawing-toolbar-btn';
        penBtn.style.cssText = `
            width: 28px; height: 28px; border: none; border-radius: 4px;
            background: ${!this.selectedToolEraser ? 'rgba(255,255,255,0.25)' : 'transparent'};
            color: #ccc; cursor: pointer; font-size: 14px;
            display: flex; align-items: center; justify-content: center;
        `;
        penBtn.textContent = '✏';
        penBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectedToolEraser = false;
            this.updateToolbarUI();
        });
        penBtn.addEventListener('mouseenter', () => this.setToolbarLabel('Drawing mode'));
        penBtn.addEventListener('mouseleave', () => this.setToolbarLabel(this.selectedToolEraser ? 'Eraser' : 'Drawing mode'));

        // Eraser button
        const eraserBtn = document.createElement('button');
        eraserBtn.className = 'drawing-toolbar-btn';
        eraserBtn.style.cssText = `
            width: 28px; height: 28px; border: none; border-radius: 4px;
            background: ${this.selectedToolEraser ? 'rgba(255,255,255,0.25)' : 'transparent'};
            color: #ccc; cursor: pointer; font-size: 14px;
            display: flex; align-items: center; justify-content: center;
        `;
        eraserBtn.textContent = '◇';
        eraserBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectedToolEraser = true;
            this.updateToolbarUI();
        });
        
        eraserBtn.addEventListener('mouseenter', () => this.setToolbarLabel('Eraser'));
        eraserBtn.addEventListener('mouseleave', () => this.setToolbarLabel(this.selectedToolEraser ? 'Eraser' : 'Drawing mode'));

        // Clear button
        const clearBtn = document.createElement('button');
        clearBtn.className = 'drawing-toolbar-btn';
        clearBtn.style.cssText = `
            width: 28px; height: 28px; border: none; border-radius: 4px;
            background: transparent; color: #ccc; cursor: pointer; font-size: 14px;
            display: flex; align-items: center; justify-content: center;
        `;
        clearBtn.textContent = '⌫';
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.wormTrailCanvas) {
                const ctx = this.wormTrailCanvas.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, this.wormTrailCanvas.width, this.wormTrailCanvas.height);
            }
        });
        clearBtn.addEventListener('mouseenter', () => this.setToolbarLabel('Clear canvas'));
        clearBtn.addEventListener('mouseleave', () => this.setToolbarLabel(this.selectedToolEraser ? 'Eraser' : 'Drawing mode'));

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'drawing-toolbar-btn';
        closeBtn.style.cssText = `
            width: 28px; height: 28px; border: none; border-radius: 4px;
            background: transparent; color: #ccc; cursor: pointer; font-size: 14px;
            display: flex; align-items: center; justify-content: center;
        `;
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.exitDrawingMode();
        });

        closeBtn.addEventListener('mouseenter', () => this.setToolbarLabel('Exit drawing mode'));
        closeBtn.addEventListener('mouseleave', () => this.setToolbarLabel(this.selectedToolEraser ? 'Eraser' : 'Drawing mode'));

        btnRow.appendChild(penBtn);
        btnRow.appendChild(eraserBtn);
        btnRow.appendChild(clearBtn);
        btnRow.appendChild(closeBtn);

        // Text label under buttons
        const label = document.createElement('div');
        label.className = 'drawing-toolbar-label';
        label.style.cssText = `
            font-size: 10px; color: #767d5e; text-align: center;
            padding: 0 4px 2px; white-space: nowrap; user-select: none;
        `;
        label.textContent = 'Drawing mode';

        toolbar.appendChild(btnRow);
        toolbar.appendChild(label);
        viewport.appendChild(toolbar);
    }

    private setToolbarLabel(text: string) {
        if (!this.drawingToolbarEl) return;
        const label = this.drawingToolbarEl.querySelector('.drawing-toolbar-label') as HTMLElement | null;
        if (label) label.textContent = text;
    }

    private updateToolbarUI() {
        if (!this.drawingToolbarEl) return;
        const btns = this.drawingToolbarEl.querySelectorAll('.drawing-toolbar-btn');
        if (btns[0]) (btns[0] as HTMLElement).style.background = this.selectedToolEraser ? 'transparent' : 'rgba(255,255,255,0.25)';
        if (btns[1]) (btns[1] as HTMLElement).style.background = this.selectedToolEraser ? 'rgba(255,255,255,0.25)' : 'transparent';
        this.setToolbarLabel(this.selectedToolEraser ? 'Eraser' : 'Drawing mode');

        const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;
        if (viewport) {
            if (this.selectedToolEraser) viewport.addClass('is-erasing');
            else viewport.removeClass('is-erasing');
        }
    }

    async onClose() {
        if (this._viewStateSaveTimeout) clearTimeout(this._viewStateSaveTimeout); // Clear pending timer
        this.saveViewState(); // Save immediately

        // Clean up kanban panning if closed mid-drag
        window.removeEventListener('mousemove', this.handleKanbanMouseMove);
        window.removeEventListener('mouseup', this.handleKanbanMouseUp);

        // Stop all animations!
        this.stopFireflies();
        this.stopShootingStars();
        this.stopAnt();
        this.stopWorm();
        
        if (this._renderDebounce) { clearTimeout(this._renderDebounce); this._renderDebounce = null; }
        if (this._skyUpdateInterval) {
            clearInterval(this._skyUpdateInterval);
            this._skyUpdateInterval = null;
        }

        const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;
        if (viewport) {
            viewport.removeEventListener('mousedown', this.handleMouseDown);
            viewport.removeEventListener('wheel', this.handleWheel);
            window.removeEventListener('mousemove', this.handleMouseMove);
            window.removeEventListener('mouseup', this.handleMouseUp);
            
            // Remove Mobile Touch Listeners
            viewport.removeEventListener('touchstart', this.handleTouchStart);
            viewport.removeEventListener('touchmove', this.handleTouchMove);
            viewport.removeEventListener('touchend', this.handleTouchEnd);
            viewport.removeEventListener('touchcancel', this.handleTouchEnd);
        }
    }



    // --- Kanban Panning ---
    private handleKanbanMouseDown = (e: MouseEvent) => {
        const container = e.currentTarget as HTMLElement;
        
        // Middle mouse (button 1) pans EVERYWHERE.
        const isMiddle = e.button === 1;
        
        // Check if we clicked on an actual interactive element
        const interactable = (e.target as HTMLElement).closest(
            '.garden-item, .seed-content, .column-header, .zone-add-btn, .add-column-btn, .seed-light-btn, .column-drag-handle'
        );
        
        // Left mouse (button 0) pans only if NOT interactable
        const isLeftEmpty = e.button === 0 && !interactable;

        if (isMiddle || isLeftEmpty) {
            e.preventDefault();
            this.clearSelection(); // Clear multi-selection when clicking empty space
            this.isPanningKanban = true;
            this.kanbanStartX = e.clientX;
            this.kanbanStartY = e.clientY;
            this.kanbanScrollLeft = container.scrollLeft;
            this.kanbanScrollTop = container.scrollTop;
            container.style.cursor = 'grabbing';
            container.style.userSelect = 'none';

            window.addEventListener('mousemove', this.handleKanbanMouseMove);
            window.addEventListener('mouseup', this.handleKanbanMouseUp);
        }
    };

    private handleKanbanMouseMove = (e: MouseEvent) => {
        if (!this.isPanningKanban) return;
        const container = this.containerEl.querySelector('.kanban-scroll-container') as HTMLElement | null;
        if (!container) return;

        const dx = e.clientX - this.kanbanStartX;
        const dy = e.clientY - this.kanbanStartY;
        
        container.scrollLeft = this.kanbanScrollLeft - dx;
        container.scrollTop = this.kanbanScrollTop - dy;
    };

    private handleKanbanMouseUp = () => {
        if (!this.isPanningKanban) return;
        this.isPanningKanban = false;
        const container = this.containerEl.querySelector('.kanban-scroll-container') as HTMLElement | null;
        if (container) {
            container.style.cursor = '';
            container.style.userSelect = '';
        }
        window.removeEventListener('mousemove', this.handleKanbanMouseMove);
        window.removeEventListener('mouseup', this.handleKanbanMouseUp);
        
        this.scheduleViewStateSave(); 
    };
    private handleMouseDown = (e: MouseEvent) => {
        // Middle mouse pans even in drawing mode!
        if (this.isDrawingMode && e.button !== 1) return; 
        
        const isMiddle = e.button === 1;
        const target = e.target as HTMLElement;
        // Check if we clicked a plant part or interactable element
        const isInteractable = target.closest('.interactable, [data-item-id]');
        
        // Middle mouse pans EVERYWHERE. Left mouse pans only on empty space.
        if (isMiddle || (e.button === 0 && !isInteractable)) {
            e.preventDefault();
            this.isDragging = true;
            this.startX = e.clientX - this.currentTranslateX;
            this.startY = e.clientY - this.currentTranslateY;
            const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;
            if (viewport) viewport.addClass('is-panning'); // ADD CLASS
        }
    };

    private handleMouseMove = (e: MouseEvent) => {
        // Drawing on canvas
        if (this.isDrawingMode && this.isCurrentlyDrawing) {
            this.drawOnCanvas(e);
            return;
        }
        if (!this.isDragging) return;
        e.preventDefault();

        const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;
        const world = this.containerEl.querySelector('.garden-world') as HTMLElement | null;
        if (!viewport || !world) return;

        this.currentTranslateX = e.clientX - this.startX;
        this.currentTranslateY = e.clientY - this.startY;
        this.applyWorldTransform(world, viewport);
    };

    private handleMouseUp = () => {
        const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;
        
        // If we were panning, just remove the panning class
        if (this.isDragging) {
            this.isDragging = false;
            if (viewport) viewport.removeClass('is-panning');
        }
        
        if (this.isDrawingMode && this.isCurrentlyDrawing) {
            this.isCurrentlyDrawing = false;
            this.isActivelyErasing = false; // Stroke is over
            
            // Revert cursor to the selected tool
            if (viewport) {
                if (this.selectedToolEraser) viewport.addClass('is-erasing');
                else viewport.removeClass('is-erasing');
            }
            return;
        }
    };

    private handleWheel = (e: WheelEvent) => {
        const viewport = this.containerEl.querySelector('.garden-canvas-viewport') as HTMLElement | null;
        const world = this.containerEl.querySelector('.garden-world') as HTMLElement | null;
        if (!viewport || !world) return;

        if (e.ctrlKey || e.metaKey) {
            // --- ZOOM ---
            e.preventDefault();
            const delta = -e.deltaY * 0.005;
            const newZoom = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom + delta));

            // Zoom toward cursor position (Standard 2D camera math)
            const rect = viewport.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;

            // Calculate the world coordinates currently under the cursor
            const worldX = (cursorX - this.currentTranslateX) / this.zoom;
            const worldY = (cursorY - this.currentTranslateY) / this.zoom;

            // Adjust translate to keep those coordinates under the cursor at the new zoom
            this.currentTranslateX = cursorX - (worldX * newZoom);
            this.currentTranslateY = cursorY - (worldY * newZoom);

            this.zoom = newZoom;
            this.applyWorldTransform(world, viewport);
            this.scheduleViewStateSave(); 
        } else {
            // --- PAN VERTICALLY (and horizontally if no horizontal scrollbar) ---
            e.preventDefault();
            this.currentTranslateX -= e.deltaX;
            this.currentTranslateY -= e.deltaY;
            this.applyWorldTransform(world, viewport);
        }
    };




    private applyWorldTransform(world: HTMLElement, viewport: HTMLElement) {
        // Standard 2D camera math: origin at top-left makes centering predictable
        world.style.transformOrigin = '0 0';
        world.style.transform = `translate(${this.currentTranslateX}px, ${this.currentTranslateY}px) scale(${this.zoom})`;
    }

    // --- Scroll Position Preservation ---
    saveScrollPositions(): { scrollTop: number; selectors: { selector: string; scrollTop: number; scrollLeft: number }[] } {
        const selectors = ['.kanban-scroll-container', '.kanban-list', '.seed-content', '.column-body'];
        const entries: { selector: string; scrollTop: number; scrollLeft: number }[] = [];

        for (const selector of selectors) {
            this.containerEl.querySelectorAll(selector).forEach((el, i) => {
                const htmlEl = el as HTMLElement;
                entries.push({ selector: `${selector}[${i}]`, scrollTop: htmlEl.scrollTop, scrollLeft: htmlEl.scrollLeft });
            });
        }

        return { scrollTop: 0, selectors: entries };
    }

    restoreScrollPositions(states: { scrollTop: number; selectors: { selector: string; scrollTop: number; scrollLeft: number }[] }) {
        const win = this.containerEl.ownerDocument.defaultView || window;
        // Double-rAF ensures the browser has fully painted the new layout
        win.requestAnimationFrame(() => {
            win.requestAnimationFrame(() => {
                for (const entry of states.selectors) {
                    const match = entry.selector.match(/^(.+)\[(\d+)\]$/);
                    if (!match) continue;
                    const selector = match[1];
                    const index = parseInt(match[2]);
                    const els = this.containerEl.querySelectorAll(selector);
                    if (els[index]) {
                        const htmlEl = els[index] as HTMLElement;
                        htmlEl.scrollTop = entry.scrollTop;
                        htmlEl.scrollLeft = entry.scrollLeft;
                    }
                }
            });
        });
    }

    async renderGarden(container: HTMLElement) {

        container.empty();
        const splitContainer = container.createDiv("garden-split-container");
        splitContainer.style.cssText = 'display: flex; flex-direction: column; height: 100%; overflow: hidden;';

        const canvasParent = splitContainer.createDiv("garden-canvas-area");
        canvasParent.style.cssText = `flex: 0 0 ${this._splitRatio * 100}%; min-height: 100px; overflow: hidden; position: relative;`;
        await this.renderGardenCanvas(canvasParent);

        // --- Draggable Resizer ---
        const resizer = splitContainer.createDiv("garden-resizer");
        resizer.style.cssText = 'flex: 0 0 4px; cursor: row-resize; background: var(--background-modifier-border); z-index: 15;';

        const bottomHalf = splitContainer.createDiv("garden-bottom-half");
        bottomHalf.style.cssText = 'flex: 1 1 auto; min-height: 100px; overflow: hidden; display: flex; flex-direction: column;';

        // --- Resizer Drag Logic ---
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            resizer.addClass('is-dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none'; // Prevent text highlighting while dragging

            const onMouseMove = (ev: MouseEvent) => {
                const rect = splitContainer.getBoundingClientRect();
                // Calculate mouse position relative to the container
                let y = ev.clientY - rect.top;
                
                // Clamp values so neither pane gets completely squished
                y = Math.max(100, Math.min(rect.height - 100, y));
                
                // Apply explicit pixel heights instead of flex
                canvasParent.style.flex = `0 0 ${y}px`;
                bottomHalf.style.flex = `0 0 ${rect.height - y - 4}px`; // -4 for the resizer height
            };

            const onMouseUp = () => {
                resizer.removeClass('is-dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                // Save the split ratio so it persists across re-renders
                const rect = splitContainer.getBoundingClientRect();
                const canvasHeight = canvasParent.getBoundingClientRect().height;
                this._splitRatio = canvasHeight / rect.height;
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });

        const scrollContainer = bottomHalf.createDiv("kanban-scroll-container");
        scrollContainer.style.cssText = 'display: flex; gap: 12px; align-items: stretch;';
        
        // Attach the pan listener
        scrollContainer.addEventListener('mousedown', this.handleKanbanMouseDown);
        scrollContainer.addEventListener('auxclick', (e) => e.preventDefault()); // Prevent middle-click autoscroll bug

        const addLeftBtn = scrollContainer.createDiv({ cls: "add-column-btn" });
        addLeftBtn.createDiv({ cls: "add-column-btn-inner", text: "+" });
        addLeftBtn.onclick = () => this.createNewProject('left');

        if (this.app.gardenData.length === 0) {
            scrollContainer.addClass("is-empty"); // lets the + buttons fill the height so they're centered
            const emptyMsg = scrollContainer.createDiv("kanban-empty-message");
            emptyMsg.createEl("h3", { text: "🌱 Your Garden is Empty" });
            emptyMsg.createEl("p", { text: "Click + to plant your first seed!" });
        } else {
            this.app.gardenData.forEach(project => {
                if (project && project.stem && project.flowers) {
                    this.createProjectColumn(scrollContainer, project);
                }
            });

            this.alignSeedCells(scrollContainer);
            
            
        }

        const addRightBtn = scrollContainer.createDiv({ cls: "add-column-btn" });
        addRightBtn.createDiv({ cls: "add-column-btn-inner", text: "+" });
        addRightBtn.onclick = () => this.createNewProject('right');

        Sortable.create(scrollContainer, {
            animation: 150,
            ghostClass: 'sortable-column-ghost',
            handle: '.column-drag-handle',
            filter: '.add-column-btn',
            onEnd: (evt: SortableEvent) => this.handleColumnDrop(evt)
        });
    }



    
    private async renderGardenCanvas(parent: HTMLElement) {
        const viewport = parent.createDiv("garden-canvas-viewport");
        viewport.style.cssText = 'width: 100%; height: 100%; overflow: hidden; position: relative; cursor: grab; background-color: var(--background-primary);';
        const world = viewport.createDiv("garden-world");
        world.style.background = 'transparent';
        
        // Camera coordinates are stored in the class instance and persist automatically!
        // We just apply them here.

        const WORLD_PADDING = 320; // ~10x eraser diameter on each side
        const calculatedWidth = Math.max(600, this.app.gardenData.length * PLANT_SPACING + WORLD_PADDING * 2);
        world.style.width = `${calculatedWidth}px`;

        // --- Phase 1: Preload all images first ---
        for (const project of this.app.gardenData) {
            await this.preloadImages(project);
        }

        // Preload bg & cloud images for pixel-scale sizing
        const bgImg = new Image();
        bgImg.src = bgImageUrl;
        await new Promise<void>(r => { bgImg.onload = () => r(); bgImg.onerror = () => r(); });
        const cloudImg = new Image();
        cloudImg.src = cloudUrl;
        await new Promise<void>(r => { cloudImg.onload = () => r(); cloudImg.onerror = () => r(); });
        const bgScaledH = Math.round(bgImg.naturalHeight * PIXEL_SCALE);
        const cloudScaledH = Math.round(cloudImg.naturalHeight * PIXEL_SCALE);
        const cloudScaledW = Math.round(cloudImg.naturalWidth * PIXEL_SCALE);

        // --- Phase 2: Calculate dynamic sky/ground heights from plant content ---
        let maxAbove = 0;
        let maxUnderground = 0;
        const extentsMap: { aboveHeight: number; undergroundDepth: number }[] = [];
        for (const project of this.app.gardenData) {
            const extents = this.calculateProjectExtents(project);
            extentsMap.push(extents);
            if (extents.aboveHeight > maxAbove) maxAbove = extents.aboveHeight;
            if (extents.undergroundDepth > maxUnderground) maxUnderground = extents.undergroundDepth;
        }

        const BASE_SKY_HEIGHT = 520;
        const BASE_GROUND_HEIGHT = 400;

        const skyPadding = 208;
        const groundPadding = 160;
        const skyHeight = Math.max(maxAbove + skyPadding, BASE_SKY_HEIGHT);
        const groundHeight = Math.max(maxUnderground + groundPadding, BASE_GROUND_HEIGHT);
        const totalHeight = skyHeight + groundHeight;
        this._dynamicGroundLineY = skyHeight;

        world.style.height = `${totalHeight}px`;

        // --- Sky color layer (day/night cycle) ---
        const { skyColor, starOpacity } = this.getDayNightState();
        const skyColorLayer = world.createDiv("garden-sky-color-layer");
        skyColorLayer.style.cssText = `
            position: absolute; top: 0; left: 0; right: 0;
            height: ${skyHeight}px; z-index: 0;
            background-color: ${skyColor};
            transition: background-color 30s ease;
        `;

        // --- Shooting Stars Canvas ---
        const shootingStarLayer = world.createDiv("garden-shooting-star-layer");
        // z-index 1.45 puts it above stars (1.4) but behind satellites (1.5) and mountains (1.6)
        shootingStarLayer.style.cssText = `position: absolute; top: 0; left: 0; right: 0; height: ${skyHeight}px; z-index: 1.45; pointer-events: none;`;
        const ssCanvas = document.createElement('canvas');
        // CSS scales it up to 100%, but internal resolution is 1x!
        ssCanvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; image-rendering: pixelated;';
        ssCanvas.width = Math.floor(calculatedWidth / PIXEL_SCALE);
        ssCanvas.height = Math.floor(skyHeight / PIXEL_SCALE);
        shootingStarLayer.appendChild(ssCanvas);
        this.shootingStarCanvas = ssCanvas;

        // --- Satellite Layer (DOM Elements for smooth movement) ---
        const satelliteLayer = world.createDiv("garden-satellite-layer");
        // z-index 1.1 puts it behind stars (1.4), mountains (1.6), and plants (5).
        // overflow: hidden clips them so they can never leave the sky frame!
        satelliteLayer.style.cssText = `position: absolute; top: 0; left: 0; right: 0; height: ${skyHeight}px; z-index: 1.1; pointer-events: none; overflow: hidden;`;
        this.satelliteLayer = satelliteLayer;

        // --- Stars layer (visible at night) ---
        const starsLayer = world.createDiv("garden-stars-layer");
        starsLayer.style.cssText = `
            position: absolute; top: 0; left: 0; right: 0;
            height: ${skyHeight}px; z-index: 1.4;
            opacity: ${starOpacity};
            transition: opacity 30s ease;
            pointer-events: none;
            mix-blend-mode: screen;
            image-rendering: pixelated;
        `;
        // Load stars GIF at runtime (not bundled) and set as background
        const starsUrl = starsPatternUrl;
        if (starsUrl) {
            // Scale the GIF to match pixel art scale (like bg/plants)
            const starsImg = new Image();
            starsImg.src = starsUrl;
            await new Promise<void>(r => { starsImg.onload = () => r(); starsImg.onerror = () => r(); });
            const starsScaledW = Math.round(starsImg.naturalWidth * PIXEL_SCALE);
            const starsScaledH = Math.round(starsImg.naturalHeight * PIXEL_SCALE);
            starsLayer.style.backgroundImage = `url(${starsUrl})`;
            starsLayer.style.backgroundRepeat = 'repeat';
            starsLayer.style.backgroundSize = `${starsScaledW}px ${starsScaledH}px`;
        }

        // Update sky color every 60 seconds
        this._skyUpdateInterval = window.setInterval(() => {
            const state = this.getDayNightState();
            skyColorLayer.style.backgroundColor = state.skyColor;
            starsLayer.style.opacity = String(state.starOpacity);
            
            // Update firefly glow and color smoothly via CSS variables
            fireflyLayer.style.setProperty('--glow-opacity', String(state.starOpacity));
            fireflyLayer.style.setProperty('--firefly-color', state.starOpacity > 0.1 ? '#7eb357' : '#5e7e50');
        }, 60000);


        // --- Mountains layer (behind clouds and bg, in front of satellites) ---
        const mountainsImg = new Image();
        mountainsImg.src = mountainsUrl;
        await new Promise<void>(r => { mountainsImg.onload = () => r(); mountainsImg.onerror = () => r(); });
        const mountainsScaledH = Math.round(mountainsImg.naturalHeight * PIXEL_SCALE);
        
        const mountainsLayer = world.createDiv("garden-mountains-layer");
        mountainsLayer.style.cssText = `
            position: absolute; top: 0; left: 0; right: 0;
            height: ${skyHeight}px; z-index: 1.6;
            background-image: url(${mountainsUrl});
            background-size: auto ${mountainsScaledH}px;
            background-repeat: repeat-x;
            background-position: bottom left;
            image-rendering: pixelated;
            pointer-events: none;
        `;

        // --- Cloud layer (behind bg image, slowly scrolling right) ---
        const cloudLayer = world.createDiv("garden-cloud-layer");
        cloudLayer.style.cssText = `
            position: absolute; top: 0; left: 0; right: 0;
            height: ${skyHeight}px; z-index: 2;
            background-image: url(${cloudUrl});
            background-size: ${cloudScaledW}px ${cloudScaledH}px;
            background-repeat: repeat-x;
            background-position: bottom left;
            image-rendering: pixelated;
            opacity: 0.5;
            animation: garden-cloud-scroll ${CLOUD_SCROLL_DURATION}s linear infinite;
        `;

        // Inject keyframe if not already present
        if (!document.getElementById('garden-cloud-keyframe')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'garden-cloud-keyframe';
            styleEl.textContent = `
                @keyframes garden-cloud-scroll {
                    from { background-position-x: 0; }
                    to { background-position-x: ${cloudScaledW}px; }
                }
            `;
            document.head.appendChild(styleEl);
        }

        // --- Bg image layer (trees/mountains, pixel-scaled, in front of clouds) ---
        const bgLayer = world.createDiv("garden-bg-layer");
        bgLayer.style.cssText = `
            position: absolute; top: 0; left: 0; right: 0;
            height: ${skyHeight}px; z-index: 2;
            background-image: url(${bgImageUrl});
            background-size: auto ${bgScaledH}px;
            background-repeat: repeat-x;
            background-position: bottom left;
            image-rendering: pixelated;
        `;

        // --- Ground layer (bottom portion, sized to fit deepest roots) ---
        const groundLayer = world.createDiv("garden-ground-layer");
        groundLayer.style.cssText = `
            position: absolute; bottom: 0; left: 0; right: 0;
            height: ${groundHeight}px; z-index: 2;
            background-image: url(${groundUrl});
            background-size: ${Math.round(STEM_ORIGIN_WIDTH * PIXEL_SCALE / 3)}px ${Math.round(STEM_ORIGIN_WIDTH * PIXEL_SCALE / 3)}px;
            background-repeat: repeat;
        `;

        // --- Trail layer (ground only, like the worm) ---
        const trailLayer = world.createDiv("garden-worm-trail-layer");
        trailLayer.style.zIndex = "3";
        trailLayer.style.position = 'absolute';
        trailLayer.style.top = `${skyHeight}px`;
        trailLayer.style.bottom = '0';
        trailLayer.style.left = '0';
        trailLayer.style.right = '0';
        trailLayer.style.pointerEvents = 'none';
        const trailCanvas = document.createElement('canvas');
        trailCanvas.style.position = 'absolute';
        trailCanvas.style.top = '0';
        trailCanvas.style.left = '0';
        trailCanvas.style.opacity = '0.12';
        trailCanvas.width = calculatedWidth;
        trailCanvas.height = groundHeight;
        trailLayer.appendChild(trailCanvas);
        this.wormTrailCanvas = trailCanvas;

        const wormLayer = world.createDiv("garden-worm-layer");
        wormLayer.style.zIndex = "4";
        wormLayer.style.position = 'absolute';
        wormLayer.style.inset = '0';

        const plantsLayer = world.createDiv("garden-plants-layer");
        plantsLayer.style.zIndex = "5";



        // --- Fireflies ---
        const fireflyLayer = world.createDiv("garden-firefly-layer");
        fireflyLayer.style.cssText = 'position: absolute; inset: 0; z-index: 6; pointer-events: none;';
        
        // Set initial day/night colors based on star opacity
        const isNight = starOpacity > 0.1;
        fireflyLayer.style.setProperty('--firefly-color', isNight ? '#7eb357' : '#5e7e50');
        fireflyLayer.style.setProperty('--glow-opacity', String(starOpacity));
        
        this.createFireflies(fireflyLayer, skyHeight);





        // --- Ant: sits on the horizon line ---
        const antEl = plantsLayer.createDiv("garden-ant");
        antEl.style.backgroundImage = `url(${ant1Url})`;
        antEl.style.position = 'absolute';
        antEl.style.bottom = `${groundHeight}px`;
        
        // Dynamically size the ant to match PIXEL_SCALE
        const antImg = new Image();
        antImg.src = ant1Url;
        antImg.onload = () => {
            antEl.style.width = `${antImg.naturalWidth * PIXEL_SCALE}px`;
            antEl.style.height = `${antImg.naturalHeight * PIXEL_SCALE}px`;
        };

        // --- Worm ---
        this.createWormElements(wormLayer);

        // --- Phase 3: Render plants — each wrapper's top-left IS the horizon line ---
        let index = 0;
        for (const project of this.app.gardenData) {
            const plantWrapper = plantsLayer.createDiv("garden-plant-wrapper");
            plantWrapper.dataset.projectId = project.id; // <--- ADD THIS LINE
            plantWrapper.style.position = 'absolute';
            plantWrapper.style.left = `${WORLD_PADDING + (index * PLANT_SPACING) + (PLANT_SPACING / 2)}px`;
            // stemContainer uses top: 0 as the horizon, so wrapper top = skyHeight
            plantWrapper.style.top = `${skyHeight}px`;
            this.renderPlantSprite(plantWrapper, project);
            index++;
        }


        // Apply the restored pan/zoom transform
        this.applyWorldTransform(world, viewport);


        viewport.addEventListener('mousedown', this.handleMouseDown);
        viewport.addEventListener('wheel', this.handleWheel, { passive: false });
        
        // Mobile Touch Listeners
        viewport.addEventListener('touchstart', this.handleTouchStart, { passive: false });
        viewport.addEventListener('touchmove', this.handleTouchMove, { passive: false });
        viewport.addEventListener('touchend', this.handleTouchEnd);
        viewport.addEventListener('touchcancel', this.handleTouchEnd);
        
        // Clean up global listeners to prevent duplicates on re-render
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
    }

    // Grabs all image paths in a project and ensures they are cached in memory
    private async preloadImages(project: ProjectData) {
        // We gather all image paths, INCLUDING the seed!
        const pathsToLoad = [
            ...project.stem.map(s => s.imagePath),
            ...project.flowers.map(f => f.imagePath),
            ...project.roots.map(r => r.imagePath),
            ...project.minerals.map(m => m.imagePath),
            project.seedImagePath // <--- ADD THIS LINE
        ].filter((path): path is string => path !== undefined); // Filter out undefineds

        const promises = pathsToLoad.map(path => this.app.assetManager.getImageUrl(path));
        await Promise.all(promises);
    }

    // Pre-calculate above-ground height and underground depth for a project
    private calculateProjectExtents(project: ProjectData): { aboveHeight: number; undergroundDepth: number } {
        const defaultStep = (STEM_ORIGIN_HEIGHT - STEM_OVERLAP_ORIGIN) * PIXEL_SCALE;
        const aboveCount = project.stem.length + project.flowers.length;
        const undergroundCount = 1 + project.roots.length + project.minerals.length; // +1 for seed
        return {
            aboveHeight: aboveCount * defaultStep,
            undergroundDepth: undergroundCount * defaultStep
        };
    }

    private getDayNightState(): { skyColor: string; starOpacity: number } {
        const now = new Date();
        const hour = now.getHours() + now.getMinutes() / 60;

        // Scandinavia July — midnight sun: never truly dark, just a brief twilight dip around midnight
        const duskColor = [232, 188, 95];      // warm orange dusk rgb(232, 188, 95)
        const twilightColor = [0, 0, 0];    // night #000000 rgb(0,0,0)
        const dawnColor = [137, 224, 155];     //  rgb(137, 224, 155)
        const dayColor = [135, 206, 235];      // #87CEEB clear sky.  

        const lerp = (a: number[], b: number[], t: number): string => {
            const r = Math.round(a[0] + (b[0] - a[0]) * t);
            const g = Math.round(a[1] + (b[1] - a[1]) * t);
            const bl = Math.round(a[2] + (b[2] - a[2]) * t);
            return `rgb(${r}, ${g}, ${bl})`;
        };

        let skyColor: string;
        let starOpacity: number;

        if (hour < 1) {
            // Night -> twilight (heading toward midnight minimum)
            const t = hour; // 0→1
            skyColor = lerp(twilightColor, twilightColor, t);
            starOpacity = 0.35;
        } else if (hour < 2.5) {
            // Deepest "night" — just a brief twilight dip, never dark
            skyColor = `rgb(${twilightColor.join(', ')})`;
            starOpacity = 0.35;
        } else if (hour < 4) {
            // Twilight -> dawn (sun rising again quickly)
            const t = (hour - 2.5) / 1.5;
            skyColor = lerp(twilightColor, dawnColor, t);
            starOpacity = 0.35 * (1 - t);
        } else if (hour < 6) {
            // Dawn -> day
            const t = (hour - 4) / 2;
            skyColor = lerp(dawnColor, dayColor, t);
            starOpacity = 0;
        } else if (hour < 18) {
            // Long day — 12 hours of full daylight
            skyColor = `rgb(${dayColor.join(', ')})`;
            starOpacity = 0;
        } else if (hour < 20) {
            // Day -> dusk
            const t = (hour - 18) / 2;
            skyColor = lerp(dayColor, duskColor, t);
            starOpacity = 0;
        } else if (hour < 22) {
            // Dusk -> twilight
            const t = (hour - 20) / 2;
            skyColor = lerp(duskColor, twilightColor, t);
            starOpacity = 0.35 * t;
        } else {
            // Twilight holding — never goes fully dark
            skyColor = `rgb(${twilightColor.join(', ')})`;
            starOpacity = 0.35;
        }

        return { skyColor, starOpacity };
    }


    // Helper to load image dimensions asynchronously
    private async getImageDimensions(url: string | null): Promise<{ width: number; height: number; overlap: number }> {
        let scaledWidth = STEM_ORIGIN_WIDTH * PIXEL_SCALE;
        let scaledHeight = STEM_ORIGIN_HEIGHT * PIXEL_SCALE;
        let scaledOverlap = STEM_OVERLAP_ORIGIN * PIXEL_SCALE;

        if (url) {
            const img = new Image();
            img.src = url;
            await new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve(); // Resolve anyway to avoid hanging
            });
            
            if (img.naturalWidth > 0) {
                scaledWidth = Math.round(img.naturalWidth * PIXEL_SCALE);
                scaledHeight = Math.round(img.naturalHeight * PIXEL_SCALE);
                scaledOverlap = Math.round(scaledHeight * 0.15);
            }
        }
        return { width: scaledWidth, height: scaledHeight, overlap: scaledOverlap };
    }


    private scareFireflies(projectId: string) {
        const wrapper = this.containerEl.querySelector(`.garden-plant-wrapper[data-project-id="${projectId}"]`) as HTMLElement | null;
        if (!wrapper) return;

        const leftStr = wrapper.style.left;
        const center = leftStr ? parseFloat(leftStr) : 0;
        const width = parseInt(wrapper.dataset.width || '30');
        const left = center - (width / 2);
        const right = center + (width / 2);

        for (const f of this.fireflyState) {
            if (f.isLanded && f.landedX >= left && f.landedX <= right) {
                f.isLanded = false;
                f.cx = f.landedX;
                f.cy = f.landedY;
                // Give them a gentle burst of speed to fly away
                f.vx = (Math.random() - 0.5) * 0.5;
                f.vy = -0.25; // Gently float upwards
                f.landedUntil = 0;
            }
        }
    }

    
    private attachPlantPartEvents(partDiv: HTMLElement, itemId: string, projectId: string) {
        // Only scare fireflies if interacting with above-ground parts!
        const isAboveGround = partDiv.classList.contains('garden-stem-part') || partDiv.classList.contains('garden-flower-part');

        partDiv.addEventListener('mouseenter', () => {
            if (isAboveGround) this.scareFireflies(projectId);
            const cell = this.containerEl.querySelector(`.garden-item[data-id="${itemId}"], .seed-content[data-id="${itemId}"]`) as HTMLElement | null;
            if (cell) cell.addClass('is-hover-highlighted');
        });

        partDiv.addEventListener('mouseleave', () => {
            const cell = this.containerEl.querySelector(`.garden-item[data-id="${itemId}"], .seed-content[data-id="${itemId}"]`) as HTMLElement | null;
            if (cell) cell.removeClass('is-hover-highlighted');
        });

        partDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isAboveGround) this.scareFireflies(projectId);
            const cell = this.containerEl.querySelector(`.garden-item[data-id="${itemId}"], .seed-content[data-id="${itemId}"]`) as HTMLElement | null;
            if (cell) {
                // Smoothly center the cell in the Kanban scroll container
                cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                
                // Trigger the flash animation
                cell.addClass('is-click-flash');
                setTimeout(() => cell.removeClass('is-click-flash'), 800);
            }
        });


    }

    private async renderPlantSprite(parent: HTMLElement, project: ProjectData) {
        const stemContainer = parent.createDiv("garden-stem-container");
        // If standby, don't apply hue-rotate so the silhouette color is pure!
        stemContainer.style.filter = project.standby ? 'none' : `hue-rotate(${project.hue ?? 0}deg)`;
        stemContainer.style.position = 'relative';

        // --- 1. ABOVE GROUND ---
        const aboveStack: { id: string; type: 'stem' | 'flower' | 'seed'; imagePath?: string; highlighted?: boolean }[] = [
            ...[...project.stem].reverse().map(s => ({ id: s.id, type: 'stem' as const, imagePath: s.imagePath, highlighted: s.highlighted })),
            ...[...project.flowers].reverse().map(f => ({ id: f.id, type: 'flower' as const, imagePath: f.imagePath, highlighted: f.highlighted }))
        ];

        let aboveY = 0;
        let maxWidth = 0;
        const flipCounters: Record<string, number> = { stem: 0, flower: 0, seed: 0, root: 0, mineral: 0 };
        let flipIndex = 0;

        // Use a for...of loop so we can await inside it
        for (const block of aboveStack) {
            const partDiv = stemContainer.createDiv(`garden-${block.type}-part`);
            partDiv.dataset.itemId = block.id;
            this.attachPlantPartEvents(partDiv, block.id, project.id);
            if (block.highlighted) partDiv.addClass('garden-part-slow-pulse'); // <--- ADD THIS
            const isFlipped = flipIndex % 2 !== 0;
            flipIndex++;

            const hash = simpleHash(block.id);
            let url: string | null = null;

            if (block.imagePath) {
                url = this.app.assetManager.getImageUrlSync(block.imagePath);
            }

            if (!url) {
                if (block.type === 'flower') {
                    url = hash % 2 === 0 ? flower1Url : flower2Url;
                } else {
                    url = stemParts[hash % stemParts.length];
                }
            }

            // Await dimensions
            const { width: scaledWidth, height: scaledHeight } = await this.getImageDimensions(url);
            const step = FIXED_STACK_STEP; // Use fixed step so tall images just overlap more!
            if (scaledWidth > maxWidth) maxWidth = scaledWidth;

            partDiv.style.backgroundImage = url ? `url(${url})` : 'none';
            partDiv.style.width = `${scaledWidth}px`;
            partDiv.style.height = `${scaledHeight}px`;
            partDiv.style.backgroundSize = 'contain';
            partDiv.style.backgroundRepeat = 'no-repeat';
            partDiv.style.backgroundPosition = 'bottom center'; // Changed to center
            partDiv.style.position = 'absolute';
            partDiv.style.left = '50%'; // Changed to 50%
            partDiv.style.top = `${-(aboveY + scaledHeight)}px`;

            // Combine centering with flipping
            partDiv.style.transform = isFlipped ? 'translateX(-50%) scaleX(-1)' : 'translateX(-50%)';
            aboveY += step;
        }

        // --- 2. BELOW GROUND ---
        // Helper to render a single part div at a given Y (now async)
        const renderUndergroundPart = async (
            block: { id: string; type: 'root' | 'mineral' | 'seed'; imagePath?: string; highlighted?: boolean },
            y: number
        ): Promise<{ width: number; height: number; step: number }> => {
            const partDiv = stemContainer.createDiv(`garden-${block.type}-part`);
            partDiv.dataset.itemId = block.id;
            this.attachPlantPartEvents(partDiv, block.id, project.id);
            if (block.highlighted) partDiv.addClass('garden-part-slow-pulse'); 
            const isFlipped = flipCounters[block.type] % 2 !== 0;
            flipCounters[block.type]++;

            let url: string | null = null;
            if (block.imagePath) {
                url = this.app.assetManager.getImageUrlSync(block.imagePath);
            }

            // Await dimensions
            const { width: scaledWidth, height: scaledHeight } = await this.getImageDimensions(url);
            const step = FIXED_STACK_STEP; // Use fixed step so tall images just overlap more!
            if (scaledWidth > maxWidth) maxWidth = scaledWidth;

            partDiv.style.backgroundImage = url ? `url(${url})` : 'none';
            partDiv.style.width = `${scaledWidth}px`;
            partDiv.style.height = `${scaledHeight}px`;
            partDiv.style.backgroundSize = 'contain';
            partDiv.style.backgroundRepeat = 'no-repeat';
            partDiv.style.backgroundPosition = 'top center'; // Changed to center
            partDiv.style.position = 'absolute';
            partDiv.style.left = '50%'; // Changed to 50%
            partDiv.style.top = `${y}px`;

            // Combine centering with flipping
            partDiv.style.transform = isFlipped ? 'translateX(-50%) scaleX(-1)' : 'translateX(-50%)';
            return { width: scaledWidth, height: scaledHeight, step };
        };

        // Seed first (await it)
        const seedResult = await renderUndergroundPart(
            { id: project.id, type: 'seed', imagePath: project.seedImagePath },
            0
        );
        
        // Apply standby silhouette effect to the entire plant
        if (project.standby) {
            stemContainer.addClass('is-standby-plant');
        }
        let undergroundY = seedResult.step;

        // Pair roots and minerals
        const maxUnderground = Math.max(project.roots.length, project.minerals.length);
        for (let i = 0; i < maxUnderground; i++) {
            let pairStep = seedResult.step;

            // Render roots normally (even in standby)
                if (project.roots[i]) {
                    const r = await renderUndergroundPart(
                        { id: project.roots[i].id, type: 'root', imagePath: project.roots[i].imagePath, highlighted: project.roots[i].highlighted },
                        undergroundY
                    );
                pairStep = r.step;
            }
            
            // ONLY render minerals if NOT in standby!
                if (project.minerals[i] && !project.standby) {
                    const m = await renderUndergroundPart(
                        { id: project.minerals[i].id, type: 'mineral', imagePath: project.minerals[i].imagePath, highlighted: project.minerals[i].highlighted },
                        undergroundY
                    );
                pairStep = m.step;
            }
            undergroundY += pairStep;
        }

        stemContainer.style.width = `${maxWidth}px`;
        // Shift the container left by half its width to perfectly center it on the anchor point!
        stemContainer.style.left = `${-maxWidth / 2}px`;
        
        // Store the calculated width on the wrapper so fireflies can read it instantly!
        parent.dataset.width = maxWidth.toString();
    }


    private highlightPlantPart(itemId: string) {
        const selector = `.garden-stem-part[data-item-id="${itemId}"], .garden-flower-part[data-item-id="${itemId}"], .garden-root-part[data-item-id="${itemId}"], .garden-mineral-part[data-item-id="${itemId}"], .garden-seed-part[data-item-id="${itemId}"]`;
        const part = this.containerEl.querySelector(selector) as HTMLElement | null;
        if (!part) return;

        // Preserve the original transform (e.g. scaleX(-1) for flipped parts)
        part.style.setProperty('--original-transform', part.style.transform || 'scaleX(1)');

        // Bounce animation (one-shot, always plays)
        part.classList.remove('garden-part-bounce');
        void part.offsetWidth;
        part.classList.add('garden-part-bounce');

        // Keep brightness on until explicitly unhighlighted
        part.classList.add('garden-part-highlighted');
    }

    private unhighlightPlantPart(itemId: string) {
        const selector = `.garden-stem-part[data-item-id="${itemId}"], .garden-flower-part[data-item-id="${itemId}"], .garden-root-part[data-item-id="${itemId}"], .garden-mineral-part[data-item-id="${itemId}"], .garden-seed-part[data-item-id="${itemId}"]`;
        const part = this.containerEl.querySelector(selector) as HTMLElement | null;
        if (!part) return;
        part.classList.remove('garden-part-highlighted');
    }



    private applyHighlightPulse(itemId: string) {
        const selector = `.garden-stem-part[data-item-id="${itemId}"], .garden-flower-part[data-item-id="${itemId}"], .garden-root-part[data-item-id="${itemId}"], .garden-mineral-part[data-item-id="${itemId}"], .garden-seed-part[data-item-id="${itemId}"]`;
        const part = this.containerEl.querySelector(selector) as HTMLElement | null;
        if (part) part.addClass('garden-part-slow-pulse');
    }

    private removeHighlightPulse(itemId: string) {
        const selector = `.garden-stem-part[data-item-id="${itemId}"], .garden-flower-part[data-item-id="${itemId}"], .garden-root-part[data-item-id="${itemId}"], .garden-mineral-part[data-item-id="${itemId}"], .garden-seed-part[data-item-id="${itemId}"]`;
        const part = this.containerEl.querySelector(selector) as HTMLElement | null;
        if (part) part.removeClass('garden-part-slow-pulse');
    }

    /**
     * Store updates (another tab, another device) replace app.gardenData with fresh objects,
     * so a project captured by a modal or an event handler may be stale by the time it is used.
     * Always mutate the live object.
     */
    private live(project: ProjectData): ProjectData {
        return this.app.gardenData.find(p => p.id === project.id) ?? project;
    }

    private liveItem(itemId: string): LayerItem | null {
        for (const p of this.app.gardenData) {
            for (const layer of ['stem', 'flowers', 'roots', 'minerals'] as const) {
                const found = p[layer].find(i => i.id === itemId);
                if (found) return found;
            }
        }
        return null;
    }

    private _highlightedItemId: string | null = null;

    private selectedCells: HTMLElement[] = [];

    private clearSelection() {
        this.selectedCells.forEach(c => {
            c.removeClass("is-selected");
            const itemId = c.dataset.id;
            if (itemId) this.unhighlightPlantPart(itemId); // Unhighlight plant part!
        });
        this.selectedCells = [];
        if (this._highlightedItemId) {
            this.unhighlightPlantPart(this._highlightedItemId);
            this._highlightedItemId = null;
        }
    }

    private selectSingleCell(el: HTMLElement) {
        this.clearSelection();
        el.addClass("is-selected");
        this.selectedCells.push(el);
        const itemId = el.dataset.id;
        if (itemId) {
            this._highlightedItemId = itemId;
            this.highlightPlantPart(itemId);
        }
    }

    private async deleteSelectedCells() {
        if (this.selectedCells.length === 0) return;
        
        const toDelete = this.selectedCells.map(cell => {
            const projectId = cell.parentElement?.dataset.projectId;
            const arrayName = cell.parentElement?.dataset.array as 'stem' | 'flowers' | 'minerals' | 'roots';
            const itemId = cell.dataset.id;
            return { projectId, arrayName, itemId };
        });

        for (const sel of toDelete) {
            const project = this.app.gardenData.find(p => p.id === sel.projectId);
            if (project && sel.arrayName && sel.itemId) {
                project[sel.arrayName] = project[sel.arrayName].filter(i => i.id !== sel.itemId);
            }
        }
        
        this.clearSelection();
        await this.app.saveGardenData();
        this.onOpen();
    }

    private selectCell(el: HTMLElement) {
        // Unhighlight previous
        if (this._highlightedItemId) {
            this.unhighlightPlantPart(this._highlightedItemId);
        }
        this.containerEl.querySelectorAll('.garden-item.is-selected').forEach(s => s.removeClass('is-selected'));
        el.addClass('is-selected');
        const itemId = el.dataset.id;
        if (itemId) {
            this._highlightedItemId = itemId;
            this.highlightPlantPart(itemId);
        }
    }

    private deselectCell(el: HTMLElement) {
        el.removeClass('is-selected');
        const itemId = el.dataset.id;
        if (itemId && this._highlightedItemId === itemId) {
            this.unhighlightPlantPart(itemId);
            this._highlightedItemId = null;
        }
    }

    private startEditing(el: HTMLElement, item: LayerItem) {
        el.removeClass('is-selected');
        el.addClass('is-editing');
        el.contentEditable = "true";
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    }

    private stopEditing(el: HTMLElement, item: LayerItem) {
        el.removeClass('is-editing');
        el.contentEditable = "false";
        const newText = el.getText().trim();
        if (newText !== item.content) {
            item.content = newText;
            const live = this.liveItem(item.id);
            if (live && live !== item) live.content = newText;
            this.app.saveGardenData();
        }
    }

    private async deleteCell(el: HTMLElement, item: LayerItem, project: ProjectData, arrayName: 'stem' | 'flowers' | 'minerals' | 'roots') {
        const target = this.live(project);
        const index = target[arrayName].findIndex(i => i.id === item.id);
        if (index !== -1) {
            target[arrayName].splice(index, 1);
            await this.app.saveGardenData();
            this.onOpen();
        }
    }

    /**
     * Align seed cells across all columns by padding the outer column wrapper.
     * Uses double-requestAnimationFrame to ensure layout is settled before measuring.
     */
    private alignSeedCells(container?: HTMLElement) {
        const scrollContainer = container ?? this.containerEl.querySelector('.kanban-scroll-container');
        if (!scrollContainer) return;
        
        const win = this.containerEl.ownerDocument.defaultView || window;
        // Double rAF: first frame lets the browser lay out, second frame measures the settled layout
        win.requestAnimationFrame(() => {
            win.requestAnimationFrame(() => {
                const columns = scrollContainer.querySelectorAll('.project-column');
                
                if (columns.length < 2) return;
                let maxTopH = 0, maxBotH = 0;
                columns.forEach((colEl) => {
                    const col = colEl as HTMLElement;
                    const topH = (col.querySelector('.column-top-half') as HTMLElement)?.offsetHeight ?? 0;
                    const botH = (col.querySelector('.column-bottom-half') as HTMLElement)?.offsetHeight ?? 0;
                    if (topH > maxTopH) maxTopH = topH;
                    if (botH > maxBotH) maxBotH = botH;
                });
                columns.forEach((colEl) => {
                    const col = colEl as HTMLElement;
                    const topHalf = col.querySelector('.column-top-half') as HTMLElement;
                    const botHalf = col.querySelector('.column-bottom-half') as HTMLElement;
                    let padTop = 0, padBot = 0;
                    if (topHalf) {
                        const diff = maxTopH - topHalf.offsetHeight;
                        if (diff > 0) padTop = diff;
                    }
                    if (botHalf) {
                        const diff = maxBotH - botHalf.offsetHeight;
                        if (diff > 0) padBot = diff;
                    }
                    col.style.paddingTop = `${padTop}px`;
                    col.style.paddingBottom = `${padBot}px`;
                });
                // Also align the add-column buttons (+) to vertically center on the seed row
                // Pad the inner span so the button stays full-height with the + centered via CSS
                const firstSeed = scrollContainer.querySelector('.seed-cell') as HTMLElement;
                if (firstSeed) {
                    const seedRect = firstSeed.getBoundingClientRect();
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const seedCenterY = seedRect.top - containerRect.top + seedRect.height / 2;
                    const addBtns = scrollContainer.querySelectorAll('.add-column-btn-inner');
                    addBtns.forEach((innerEl) => {
                        const inner = innerEl as HTMLElement;
                        inner.style.top = `${Math.max(0, seedCenterY)}px`;
                        inner.style.transform = 'translateY(-50%)';
                    });
                }
            });
        });
    }

// --- Divider ratio saves after edit ---
private _splitRatio = 0.5; // persisted divider position (0 = top, 1 = bottom)


    private showSeedContextMenu(e: MouseEvent, project: ProjectData, seedContent: HTMLElement) {
        const doc = this.containerEl.ownerDocument; // Get the correct window's document!
        const win = doc.defaultView || window;       // Get the correct OS window!

        // Remove any existing menu
        const existing = doc.querySelector('.garden-context-menu');
        if (existing) existing.remove();
        

        const menu = document.createElement('div');
        menu.className = 'garden-context-menu';
        menu.style.cssText = 'position: fixed; z-index: 10000; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 4px 0; min-width: 160px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';

        const menuStyle = 'display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 16px; text-align: left; background: none; border: none; cursor: pointer; font-size: 14px; color: var(--text-normal);';
        const hoverStyle = 'background: var(--background-modifier-hover);';

        // 2. Toggle Standby
        const standbyOpt = document.createElement('button');
        standbyOpt.textContent = project.standby ? 'Wake Up ⏻' : 'Standby ⏻';
        standbyOpt.style.cssText = menuStyle;
        standbyOpt.onmouseenter = () => standbyOpt.style.background = hoverStyle;
        standbyOpt.onmouseleave = () => standbyOpt.style.background = 'none';
        standbyOpt.onclick = async (ev) => {
            ev.stopPropagation();
            menu.remove();
            const live = this.live(project);
            live.standby = !live.standby;
            project.standby = live.standby;
            await this.app.saveGardenData();
            this.onOpen(); // Re-render to apply canvas filters
        };
        menu.appendChild(standbyOpt);

        // 3. Recycle Plant
        const deleteOpt = document.createElement('button');
        deleteOpt.textContent = 'Recycle Plant ♻';
        deleteOpt.style.cssText = `${menuStyle} color: #E91E63;`;
        deleteOpt.onmouseenter = () => deleteOpt.style.background = 'rgba(233, 30, 99, 0.1)';
        deleteOpt.onmouseleave = () => deleteOpt.style.background = 'none';
        deleteOpt.onclick = (ev) => {
            ev.stopPropagation();
            menu.remove();
            new ConfirmDeleteModal(project.seed, async () => {
                const index = this.app.gardenData.findIndex(p => p.id === project.id);
                if (index !== -1) {
                    this.app.gardenData.splice(index, 1);
                    await this.app.saveGardenData();
                    this.onOpen();
                }
            }).open();
        };
                // 4. Change Plant Type (only when the asset pack has more than this plant's type)
        const otherTypes = PLANT_TYPES.filter(pt => pt !== project.plantType);
        if (otherTypes.length > 0) {
            const typeHeader = document.createElement('div');
            typeHeader.textContent = 'Change Plant Type';
            typeHeader.style.cssText = `${menuStyle} font-size: 11px; text-transform: uppercase; color: var(--text-faint); pointer-events: none; margin-top: 4px; border-top: 1px solid var(--background-modifier-border); padding-top: 8px;`;
            menu.appendChild(typeHeader);
        }

        PLANT_TYPES.forEach(pt => {
            if (pt !== project.plantType) {
                const typeOpt = document.createElement('button');
                // Makes "plant_2" look like "Plant 2"
                typeOpt.textContent = pt.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()); 
                typeOpt.style.cssText = menuStyle;
                typeOpt.onmouseenter = () => typeOpt.style.background = hoverStyle;
                typeOpt.onmouseleave = () => typeOpt.style.background = 'none';
                typeOpt.onclick = async (ev: MouseEvent) => {
                    ev.stopPropagation();
                    menu.remove();
                    
                    // Change type and reassign all stem/flower images!
                    const live = this.live(project);
                    live.plantType = pt;
                    live.stem.forEach(item => { item.imagePath = this.app.assetManager.assignRandomImage('stem', pt) || undefined; });
                    live.flowers.forEach(item => { item.imagePath = this.app.assetManager.assignRandomImage('flowers', pt) || undefined; });
                    
                    await this.app.saveGardenData();
                    this.onOpen();
                };
                menu.appendChild(typeOpt);
            }
        });
        menu.appendChild(deleteOpt);

        doc.body.appendChild(menu);
        
        // Measure menu and keep it on screen
        const menuRect = menu.getBoundingClientRect();
        let menuX = e.clientX;
        let menuY = e.clientY;
        if (menuX + menuRect.width > win.innerWidth) menuX = win.innerWidth - menuRect.width - 10;
        if (menuY + menuRect.height > win.innerHeight) menuY = win.innerHeight - menuRect.height - 10;
        menuX = Math.max(10, menuX);
        menuY = Math.max(10, menuY);

        menu.style.left = `${menuX}px`;
        menu.style.top = `${menuY}px`;

        // Close on outside click
        const closeMenu = (ev: MouseEvent) => {
            if (!menu.contains(ev.target as Node)) {
                menu.remove();
                win.removeEventListener('mousedown', closeMenu, true);
            }
        };
        setTimeout(() => win.addEventListener('mousedown', closeMenu, true), 0);
    }
 
    createProjectColumn(parent: HTMLElement, project: ProjectData) {

        const column = parent.createDiv({ cls: "project-column" });
        column.dataset.projectId = project.id;
        column.style.cssText = 'display: flex; flex-direction: column; width: 230px; flex-shrink: 0;';

        const columnCard = column.createDiv("column-card");
        const columnBody = columnCard.createDiv("column-body");
        columnBody.style.cssText = 'display: flex; flex-direction: column;';

        // --- TOP HALF (Flowers, Stem) ---
        const topHalf = columnBody.createDiv("column-top-half");
        topHalf.style.cssText = 'display: flex; flex-direction: column; flex-shrink: 0;';

        const flowerZone = topHalf.createDiv("garden-zone flowers-zone");
        const flowerLabel = flowerZone.createDiv("garden-zone-label-row");
        flowerLabel.style.cssText = 'display: flex; align-items: center; position: relative;';
        flowerLabel.createDiv({ text: "⚘✽ Flowers", cls: "zone-label" });
        const flowerSpacer = flowerLabel.createDiv();
        flowerSpacer.style.flex = '1';
        const addFlowerBtn = flowerLabel.createEl('button', { cls: 'zone-add-btn' });
        addFlowerBtn.setText('+');
        addFlowerBtn.style.cssText = 'position: absolute; left: 50%; transform: translateX(-50%);';
        addFlowerBtn.onclick = () => this.addNewItem(project, 'flowers');
        this.createSortableList(flowerZone, project, 'flowers');

        const stemZone = topHalf.createDiv("garden-zone stem-zone");
        const stemLabel = stemZone.createDiv("garden-zone-label-row");
        stemLabel.style.cssText = 'display: flex; align-items: center; position: relative;';
        stemLabel.createDiv({ text: "𖣂 Stem", cls: "zone-label" });
        const stemSpacer = stemLabel.createDiv();
        stemSpacer.style.flex = '1';
        const addStemBtn = stemLabel.createEl('button', { cls: 'zone-add-btn' });
        addStemBtn.setText('+');
        addStemBtn.style.cssText = 'position: absolute; left: 50%; transform: translateX(-50%);';
        addStemBtn.onclick = () => this.addNewItem(project, 'stem');
        this.createSortableList(stemZone, project, 'stem');

        // --- SEED (Now acts as the header) ---
        const seedCell = columnBody.createDiv("garden-zone seed-cell");
        
        const dragHandle = seedCell.createDiv({ cls: "column-drag-handle", text: "⠿" });
        dragHandle.style.cssText = 'margin-right: 4px;';
        
const seedContent = seedCell.createDiv({ text: project.seed, cls: "seed-content draggable-cell", attr: { tabindex: "0" } });
        seedContent.dataset.id = project.id;
        seedContent.contentEditable = "false";
        
        // Apply Hue Filter
        seedContent.style.color = '#6e7f9c';
        seedContent.style.filter = `hue-rotate(${project.hue ?? 0}deg)`;

        seedContent.addEventListener("click", (e) => {
            if (!seedContent.hasClass("is-editing")) {
                e.stopPropagation();
                this.selectCell(seedContent);
            }
        });

        seedContent.addEventListener("dblclick", () => {
            this.startEditing(seedContent, { id: project.id, content: project.seed, isComplete: false } as LayerItem);
        });

        seedContent.addEventListener("blur", () => {
            if (seedContent.hasClass("is-editing")) {
                seedContent.removeClass("is-editing");
                seedContent.contentEditable = "false";
                const newSeed = seedContent.getText().trim();
                
                if (newSeed && newSeed !== project.seed) {
                    const live = this.live(project);
                    live.seed = newSeed;
                    live.name = newSeed;
                    project.seed = newSeed;
                    project.name = newSeed;
                    this.app.saveGardenData();
                } else if (!newSeed) {
                    seedContent.setText(project.seed);
                }
            } else {
                this.deselectCell(seedContent);
            }
        });

        seedContent.addEventListener("keydown", (e: KeyboardEvent) => {
            if (seedContent.hasClass("is-editing")) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    seedContent.blur();
                }
            } else if (seedContent.hasClass("is-selected")) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    this.startEditing(seedContent, { id: project.id, content: project.seed, isComplete: false } as LayerItem);
                }
            }
        });

                // --- Standby / Context Menu Button ---
        const menuBtn = seedCell.createEl('button', { cls: 'seed-context-btn' });
        
        const eyeClosedSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><line x1="2" y1="2" x2="22" y2="22"></line></svg>`;
        const eyeOpenSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        const dotsSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg>`;

        // Function to update the button icon based on standby state
        const updateMenuBtn = () => {
            if (project.standby) {
                menuBtn.innerHTML = eyeClosedSvg;
                menuBtn.addClass('is-standby-eye');
                column.addClass('is-standby');
            } else {
                menuBtn.innerHTML = dotsSvg;
                menuBtn.removeClass('is-standby-eye');
                column.removeClass('is-standby');
            }
        };

        // Clicking the eye toggles standby off. Clicking the dots opens the menu.
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            if (project.standby) {
                project.standby = false;
                this.live(project).standby = false;
                this.app.saveGardenData();
                this.onOpen(); // Force re-render to restore the plant visually
            } else {
                this.showSeedContextMenu(e as MouseEvent, project, seedContent);
            }
        };

        // Hover effect: swap to open eye
        menuBtn.addEventListener('mouseenter', () => {
            if (project.standby) menuBtn.innerHTML = eyeOpenSvg;
        });
        menuBtn.addEventListener('mouseleave', () => {
            if (project.standby) menuBtn.innerHTML = eyeClosedSvg;
        });

        // Right-click on seed text also opens the menu
        seedContent.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.showSeedContextMenu(e, project, seedContent);
        });

        updateMenuBtn(); // Set initial state

        // --- BOTTOM HALF (Roots, Minerals) ---
        const bottomHalf = columnBody.createDiv("column-bottom-half");
        bottomHalf.style.cssText = 'display: flex; flex-direction: column; flex-shrink: 0;';

        const rootZone = bottomHalf.createDiv("garden-zone roots-zone");
        const rootLabel = rootZone.createDiv("garden-zone-label-row");
        rootLabel.style.cssText = 'display: flex; align-items: center; position: relative;';
        rootLabel.createDiv({ text: "⫛ Roots", cls: "zone-label" });
        const rootSpacer = rootLabel.createDiv();
        rootSpacer.style.flex = '1';
        const addRootBtn = rootLabel.createEl('button', { cls: 'zone-add-btn' });
        addRootBtn.setText('+');
        addRootBtn.onclick = () => this.addNewItem(project, 'roots');
        addRootBtn.style.cssText = 'position: absolute; left: 50%; transform: translateX(-50%);';
        this.createSortableList(rootZone, project, 'roots');

        const mineralZone = bottomHalf.createDiv("garden-zone minerals-zone");
        const mineralLabel = mineralZone.createDiv("garden-zone-label-row");
        mineralLabel.style.cssText = 'display: flex; align-items: center; position: relative;';
        mineralLabel.createDiv({ text: "₊⊹˖ Minerals", cls: "zone-label" });
        const mineralSpacer = mineralLabel.createDiv();
        mineralSpacer.style.flex = '1';
        const addMineralBtn = mineralLabel.createEl('button', { cls: 'zone-add-btn' });
        addMineralBtn.setText('+');
        addMineralBtn.onclick = () => this.addNewItem(project, 'minerals');
        addMineralBtn.style.cssText = 'position: absolute; left: 50%; transform: translateX(-50%);';
        this.createSortableList(mineralZone, project, 'minerals');
    }

    createSortableList(
        parent: HTMLElement,
        project: ProjectData,
        arrayName: 'stem' | 'flowers' | 'minerals' | 'roots'
    ): HTMLElement {
        const listContainer = parent.createDiv({ cls: "kanban-list" });
        listContainer.dataset.projectId = project.id;
        listContainer.dataset.array = arrayName;

        project[arrayName].forEach(item => {
            const el = listContainer.createDiv({ cls: "garden-item draggable-cell", attr: { tabindex: "0" } });
            el.dataset.id = item.id;
            el.setText(item.content);
            if (item.highlighted) {
                el.style.fontWeight = 'bold';
                el.addClass('garden-item-highlighted');
            }
            
            el.addEventListener("mouseenter", () => {
                if (arrayName === 'stem' || arrayName === 'flowers') this.scareFireflies(project.id);
                this.highlightPlantPart(item.id);
            });

            el.addEventListener("mouseleave", () => {
                // Only remove brightness if the cell isn't selected
                if (!el.hasClass("is-selected")) {
                    this.unhighlightPlantPart(item.id);
                }
            });

            el.addEventListener("click", (e) => {
                // Ignore the second click of a double-click so it doesn't mess with editing!
                if (e.detail === 2) return; 
                
                    if (!el.hasClass("is-editing")) {
                    e.stopPropagation();
                    if (arrayName === 'stem' || arrayName === 'flowers') this.scareFireflies(project.id);
                    const currentProjectId = el.parentElement?.dataset.projectId;

                    if (e.ctrlKey || e.metaKey) {
                        if (this.selectedCells.length > 0 && this.selectedCells[0].parentElement?.dataset.projectId !== currentProjectId) {
                            this.clearSelection();
                        }
                        
                        const itemId = el.dataset.id;
                        if (el.hasClass("is-selected")) {
                            el.removeClass("is-selected");
                            this.selectedCells = this.selectedCells.filter(c => c !== el);
                            if (itemId) this.unhighlightPlantPart(itemId);
                        } else {
                            el.addClass("is-selected");
                            this.selectedCells.push(el);
                            if (itemId) this.highlightPlantPart(itemId);
                        }
                    } else if (e.shiftKey) {
                        const list = el.parentElement;
                        if (list && this.selectedCells.length > 0) {
                            const lastEl = this.selectedCells[this.selectedCells.length - 1];
                            if (lastEl.parentElement === list) {
                                const items = Array.from(list.children).filter(c => c.hasClass('garden-item')) as HTMLElement[];
                                const idx1 = items.indexOf(lastEl);
                                const idx2 = items.indexOf(el);
                                const [start, end] = [Math.min(idx1, idx2), Math.max(idx1, idx2)];
                                for (let i = start; i <= end; i++) {
                                    const cell = items[i];
                                    if (!cell.hasClass("is-selected")) {
                                        cell.addClass("is-selected");
                                        this.selectedCells.push(cell);
                                        const cItemId = cell.dataset.id;
                                        if (cItemId) this.highlightPlantPart(cItemId);
                                    }
                                }
                            } else {
                                this.selectSingleCell(el);
                            }
                        } else {
                            this.selectSingleCell(el);
                        }
                    } else {
                        this.selectSingleCell(el);
                    }
                }
            });

            el.addEventListener("dblclick", () => {
                this.startEditing(el, item);
            });

            el.addEventListener("blur", () => {
                if (el.hasClass("is-editing")) {
                    this.stopEditing(el, item);
                } else {
                    this.deselectCell(el);
                }
            });

            el.addEventListener("keydown", (e: KeyboardEvent) => {
                if (el.hasClass("is-editing")) {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        this.stopEditing(el, item);
                        el.blur();
                    }
                    if ((e.key === "Backspace" || e.key === "Delete") && el.getText().trim() === "") {
                        e.preventDefault();
                        this.deleteCell(el, item, project, arrayName);
                    }
                } else if (el.hasClass("is-selected")) {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        this.startEditing(el, item);
                    }
                    if (e.key === "Backspace" || e.key === "Delete") {
                        e.preventDefault();
                        if (this.selectedCells.length > 1) {
                            this.deleteSelectedCells();
                        } else {
                            this.deleteCell(el, item, project, arrayName);
                        }
                    }
                }
            });

            // --- Right-click context menu ---
            el.addEventListener("contextmenu", (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();

                // Close any existing context menu
                const existing = document.querySelector('.garden-context-menu');
                if (existing) existing.remove();

                // Determine if we are acting on a group or single
                const isMulti = this.selectedCells.includes(el) && this.selectedCells.length > 1;
                if (!isMulti) {
                    this.selectSingleCell(el);
                }

                const menu = document.createElement('div');
                menu.className = 'garden-context-menu';
                menu.style.cssText = 'position: fixed; z-index: 10000; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 4px 0; min-width: 140px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';

                const menuStyle = 'display: block; width: 100%; padding: 6px 16px; text-align: left; background: none; border: none; cursor: pointer; font-size: 14px; color: var(--text-normal);';
                const hoverStyle = 'background: var(--background-modifier-hover);';

                // Delete option
                const deleteOpt = document.createElement('button');
                deleteOpt.textContent = 'Delete';
                deleteOpt.style.cssText = menuStyle;
                deleteOpt.onmouseenter = () => deleteOpt.style.background = hoverStyle;
                deleteOpt.onmouseleave = () => deleteOpt.style.background = 'none';
                deleteOpt.onclick = () => {
                    menu.remove();
                    if (isMulti) {
                        this.deleteSelectedCells();
                    } else {
                        this.deleteCell(el, item, project, arrayName);
                    }
                };
                menu.appendChild(deleteOpt);

                // Highlight toggle option
                const cellsToHighlight = isMulti ? this.selectedCells : [el];
                // Check if ALL selected cells are currently highlighted to decide the button text
                const allHighlighted = cellsToHighlight.every(c => c.hasClass('garden-item-highlighted'));
                
                const highlightOpt = document.createElement('button');
                highlightOpt.textContent = allHighlighted ? 'Remove Highlight' : 'Highlight';
                highlightOpt.style.cssText = menuStyle;
                highlightOpt.onmouseenter = () => highlightOpt.style.background = hoverStyle;
                highlightOpt.onmouseleave = () => highlightOpt.style.background = 'none';
                
                highlightOpt.onclick = async () => {
                    menu.remove();
                    const newState = !allHighlighted; // The state we want to apply to all of them
                    
                    for (const cell of cellsToHighlight) {
                        const cProjectId = cell.parentElement?.dataset.projectId;
                        const cArrayName = cell.parentElement?.dataset.array as 'stem' | 'flowers' | 'minerals' | 'roots';
                        const cItemId = cell.dataset.id;
                        const cProject = this.app.gardenData.find(p => p.id === cProjectId);
                        
                        if (cProject && cArrayName && cItemId) {
                            const cItem = cProject[cArrayName].find(i => i.id === cItemId);
                            if (cItem) {
                                cItem.highlighted = newState || undefined; // Update the data model
                                cell.style.fontWeight = newState ? 'bold' : '';
                                if (newState) {
                                    cell.addClass('garden-item-highlighted');
                                    this.applyHighlightPulse(cItemId);
                                } else {
                                    cell.removeClass('garden-item-highlighted');
                                    this.removeHighlightPulse(cItemId);
                                }
                            }
                        }
                    }
                    await this.app.saveGardenData();
                };
                menu.appendChild(highlightOpt);

                                // Convert to Stem ✔️ option
                const allMinerals = isMulti 
                    ? this.selectedCells.every(cell => cell.parentElement?.dataset.array === 'minerals')
                    : (arrayName === 'minerals');

                const convertOpt = document.createElement('button');
                convertOpt.textContent = 'Convert to Stem ✔️';
                
                if (allMinerals) {
                    convertOpt.style.cssText = menuStyle;
                    convertOpt.onmouseenter = () => convertOpt.style.background = hoverStyle;
                    convertOpt.onmouseleave = () => convertOpt.style.background = 'none';
                    convertOpt.onclick = async () => {
                        menu.remove();
                        const cellsToConvert = isMulti ? this.selectedCells : [el];
                        for (const cell of cellsToConvert) {
                            const cProjectId = cell.parentElement?.dataset.projectId;
                            const cItemId = cell.dataset.id;
                            const cProject = this.app.gardenData.find(p => p.id === cProjectId);
                            if (cProject) {
                                const index = cProject.minerals.findIndex(i => i.id === cItemId);
                                if (index !== -1) {
                                    const cItem = cProject.minerals.splice(index, 1)[0];
                                    cItem.imagePath = this.app.assetManager.assignRandomImage('stem', cProject.plantType) || undefined;
                                    cProject.stem.push(cItem);
                                }
                            }
                        }
                        this.clearSelection();
                        await this.app.saveGardenData();
                        this.scheduleRender();
                    };
                } else {
                    // Faded and unclickable if selection contains non-minerals
                    convertOpt.style.cssText = `${menuStyle} opacity: 0.4; cursor: not-allowed; color: var(--text-faint);`;
                    convertOpt.disabled = true;
                }
                menu.appendChild(convertOpt);
                

                document.body.appendChild(menu);
                
                // Measure menu and keep it on screen
                const menuRect = menu.getBoundingClientRect();
                let menuX = e.clientX;
                let menuY = e.clientY;

                // Shift left if it goes off the right edge
                if (menuX + menuRect.width > window.innerWidth) {
                    menuX = window.innerWidth - menuRect.width - 10;
                }
                // Shift up if it goes off the bottom edge
                if (menuY + menuRect.height > window.innerHeight) {
                    menuY = window.innerHeight - menuRect.height - 10;
                }
                
                // Ensure it doesn't get pushed off the top/left corners
                menuX = Math.max(10, menuX);
                menuY = Math.max(10, menuY);

                // Position near cursor (adjusted)
                menu.style.left = `${menuX}px`;
                menu.style.top = `${menuY}px`;
                
                // Close on mousedown outside (capture phase bypasses stopPropagation on cells)
                const closeMenu = (ev: MouseEvent) => {
                    if (!menu.contains(ev.target as Node)) {
                        menu.remove();
                        window.removeEventListener('mousedown', closeMenu, true);
                    }
                };
                // Use setTimeout to ensure the current right-click event finishes before listening
                setTimeout(() => window.addEventListener('mousedown', closeMenu, true), 0);
            });
        });

        Sortable.create(listContainer, {
            group: 'garden-items',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: (evt: SortableEvent) => this.handleDrop(evt)
        });

        return listContainer;
    }

    async handleDrop(evt: SortableEvent) {
        const targetProjectId = evt.to.dataset.projectId;
        const sourceProjectId = evt.from.dataset.projectId;
        const targetArrayName = evt.to.dataset.array as 'stem' | 'flowers' | 'minerals' | 'roots';
        const sourceArrayName = evt.from.dataset.array as 'stem' | 'flowers' | 'minerals' | 'roots';
        const itemId = evt.item.dataset.id;

        if (!targetProjectId || !sourceProjectId || !targetArrayName || !sourceArrayName || !itemId) return;

        const sourceProject = this.app.gardenData.find(p => p.id === sourceProjectId);
        const targetProject = this.app.gardenData.find(p => p.id === targetProjectId);
        if (!sourceProject || !targetProject) return;

        const sourceArray = sourceProject[sourceArrayName];
        const itemIndex = sourceArray.findIndex(i => i.id === itemId);
        if (itemIndex === -1) return;

        const movedItem = sourceArray.splice(itemIndex, 1)[0];
        if (!movedItem) return;

        // If moved to a different category, reassign image to match new category
        if (sourceArrayName !== targetArrayName) {
            movedItem.imagePath = this.app.assetManager.assignRandomImage(targetArrayName, targetProject.plantType) || undefined;
        }

        const targetArray = targetProject[targetArrayName];
        const newIndex = evt.newIndex ?? 0;
        targetArray.splice(newIndex, 0, movedItem);

        await this.app.saveGardenData();

        // --- TARGETED UPDATE ---
        // If reordering within the exact same list, the Kanban DOM is already correct (Sortable moved it).
        // We just need to redraw the plant sprite on the canvas to match the new order.
        // This prevents the scrollbar from jumping!
        if (sourceProjectId === targetProjectId && sourceArrayName === targetArrayName) {
            const wrapper = this.containerEl.querySelector(`.garden-plant-wrapper[data-project-id="${targetProjectId}"]`) as HTMLElement | null;
            if (wrapper) {
                wrapper.empty();
                await this.renderPlantSprite(wrapper, targetProject);
                return; // Skip the full re-render!
            }
        }

        // If moving between different columns or categories, extents might change. Do a full render.
        this.scheduleRender();
    }

    async handleColumnDrop(evt: SortableEvent) {
        if (evt.oldIndex === undefined || evt.newIndex === undefined || evt.oldIndex === evt.newIndex) return;

        // Sortable indices include the +Left button at index 0, so subtract 1
        const oldIdx = evt.oldIndex - 1;
        let newIdx = evt.newIndex - 1;

        // Clamp: can't go before 0 or past the last project
        const maxIdx = this.app.gardenData.length - 1;
        if (oldIdx < 0 || newIdx < 0 || oldIdx > maxIdx || newIdx > maxIdx) return;

        const [movedProject] = this.app.gardenData.splice(oldIdx, 1);
        if (!movedProject) return;

        // Adjust newIdx if we removed an item before it
        if (oldIdx < newIdx) newIdx--;
        this.app.gardenData.splice(newIdx, 0, movedProject);

        // UPDATE ALL ORDERS: Assign 0, 1, 2, 3... based on current array position
        this.app.gardenData.forEach((proj, idx) => {
            proj.order = idx;
        });

        await this.app.saveGardenData();
        this.onOpen();
    }

     async createNewProject(position: 'left' | 'right' = 'right') {
        new CreateProjectModal(async (seed) => {
            const seedImagePath = this.app.assetManager.assignRandomImage('seeds'); 

             const newProject: ProjectData = {
                id: 'proj_' + Date.now(),
                name: seed,
                seed: seed,
                seedImagePath: seedImagePath || undefined,
                standby: false, // <--- ADD THIS
                hue: Math.floor(Math.random() * 360),
                order: this.app.gardenData.length,
                plantType: PLANT_TYPES[Math.floor(Math.random() * PLANT_TYPES.length)],
                roots: [],
                stem: [],
                flowers: [],
                minerals: []
            };

            if (position === 'left') {
                this.app.gardenData.unshift(newProject);
            } else {
                this.app.gardenData.push(newProject);
            }
            // Renumber so a plant added on the left stays on the left after reload (data is sorted by order)
            this.app.gardenData.forEach((proj, idx) => { proj.order = idx; });

            await this.app.saveGardenData();
            this.onOpen();
        }).open();
    }

    async addNewItem(project: ProjectData, arrayName: 'flowers' | 'minerals' | 'roots' | 'stem') {
        
        
        
        const titles: Record<string, string> = {
            'flowers': '✽ Add flower ✽',
            'stem': '𖣂 Add stem 𖣂',
            'roots': '⫛ Add root ⫛',
            'minerals': '₊⊹˖ Add mineral ₊⊹˖'
        };

        const placeholders: Record<string, string> = {
            'flowers': 'Result, takeaway',
            'stem': 'Completed task',
            'roots': 'Motivation, reason',
            'minerals': 'Idea, task'
        };

        const title = titles[arrayName] ?? 'Add Item';
        const placeholder = placeholders[arrayName] ?? '';

        new AddItemModal(title, placeholder, async (content) => {

            // Ask the manager for a random image from the matching vault folder
            const randomImagePath = this.app.assetManager.assignRandomImage(arrayName, project.plantType);

            const newItem: LayerItem = {
                id: 'item_' + Date.now(),
                content: content,
                isComplete: arrayName === 'flowers',
                imagePath: randomImagePath || undefined 
            };
            this.live(project)[arrayName].unshift(newItem);
            await this.app.saveGardenData();
            this.onOpen();
        }).open();
    }
}
