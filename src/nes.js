/**
 * NES Emulator - Orquestrador Principal
 *
 * Coordena CPU, PPU, APU, Memória, ROM e Input.
 *
 * Clock:
 *   CPU: ~1.789773 MHz (NTSC)
 *   PPU: 3x CPU = ~5.369319 MHz
 *   Cada frame = 29780.5 ciclos de CPU ≈ 89341 ciclos de PPU
 *
 * Loop de execução:
 *   Para cada ciclo de CPU → executa 3 ticks de PPU
 *   Renderiza frame quando PPU completa (scanline 240, dot 0)
 */

class NES {
    constructor(canvas) {
        this.canvas  = canvas;
        this.ctx     = canvas.getContext('2d');

        // Componentes
        this.rom     = new ROM();
        this.ppu     = new PPU(this);
        this.apu     = new APU(this);
        this.input   = new Input();
        this.cpu     = new CPU();
        this.mem     = new Memory(this);

        // PRG RAM ($6000–$7FFF) - 8KB
        this.prgRAM  = new Uint8Array(8192);

        // Conecta CPU ao barramento
        this.cpu.mem = this.mem;

        // Estado do emulador
        this.running     = false;
        this.paused      = false;
        this._rafId      = null;
        this._lastTime   = 0;
        this._frameCount = 0;
        this._fpsTime    = 0;
        this._fps        = 0;

        // Imagem do frame (256x240)
        this.imageData = this.ctx.createImageData(256, 240);

        // Callback quando frame é completado
        this.onFrame = null;
    }

    // ─── Carregamento de ROM ──────────────────────────────────────────────────

    loadROM(buffer) {
        this.rom.load(buffer);
        this.reset();
        return true;
    }

    reset() {
        this.ppu  = new PPU(this);
        this.apu  = new APU(this);
        this.cpu  = new CPU();
        this.mem  = new Memory(this);
        this.cpu.mem = this.mem;
        this.prgRAM.fill(0);
        this.cpu.reset();
        this.imageData = this.ctx.createImageData(256, 240);
        console.log(`[NES] Reset — PC inicial: 0x${this.cpu.PC.toString(16).toUpperCase().padStart(4,'0')}`);
    }

    // ─── Execução de um frame ─────────────────────────────────────────────────

    runFrame() {
        // NES NTSC: 29780 ciclos de CPU por frame (≈ 60Hz)
        const CPU_CYCLES_PER_FRAME = 29781;
        const prevFrame = this.ppu.frame;

        let cycleCount = 0;
        while (cycleCount < CPU_CYCLES_PER_FRAME) {
            const cpuCycles = this.cpu.step();
            cycleCount += cpuCycles;

            // PPU: 3 ticks por ciclo de CPU
            for (let i = 0; i < cpuCycles * 3; i++) {
                this.ppu.tick();
            }

            // APU
            this.apu.tick(cpuCycles);

            // Frame completo quando PPU avança de frame
            if (this.ppu.frame !== prevFrame) {
                break;
            }
        }
    }

    // ─── Renderização no Canvas ───────────────────────────────────────────────

    drawFrame() {
        const buf32 = new Uint32Array(this.imageData.data.buffer);
        for (let i = 0; i < 256 * 240; i++) {
            const c = this.ppu.frameBuffer[i];
            // NES_PALETTE é ARGB, canvas usa ABGR (little-endian RGBA)
            buf32[i] = ((c & 0xFF) << 16) | (c & 0xFF00FF00) | ((c >> 16) & 0xFF);
        }
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    // ─── Loop principal ───────────────────────────────────────────────────────

    start() {
        if (this.running) return;
        this.running = true;
        this.paused  = false;
        this._lastTime = performance.now();
        this._loop();
    }

    pause() {
        this.paused = !this.paused;
        if (!this.paused) this._loop();
    }

    stop() {
        this.running = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    _loop() {
        if (!this.running || this.paused) return;

        this._rafId = requestAnimationFrame((now) => {
            const dt = now - this._lastTime;
            this._lastTime = now;

            // Limita a no máximo 3 frames de recuperação (evita espiral de morte)
            const maxDt = 1000 / 60 * 3;
            const clampedDt = Math.min(dt, maxDt);

            // Executa frames necessários para manter 60fps
            const frameDuration = 1000 / 60;
            const framesToRun = Math.round(clampedDt / frameDuration);

            for (let f = 0; f < Math.max(1, framesToRun); f++) {
                this.runFrame();
            }

            this.drawFrame();

            // FPS counter
            this._frameCount++;
            if (now - this._fpsTime >= 1000) {
                this._fps = this._frameCount;
                this._frameCount = 0;
                this._fpsTime = now;
                if (this.onFPS) this.onFPS(this._fps);
            }

            if (this.onFrame) this.onFrame();

            this._loop();
        });
    }
}
