/**
 * NES Emulator - PPU (Picture Processing Unit)
 *
 * Timing:
 *   262 scanlines por frame (0–261)
 *   0–239:   Visible (renderização)
 *   240:     Post-render (idle)
 *   241–260: VBlank (NMI dispara na scanline 241, ciclo 1)
 *   261:     Pre-render
 *
 *   341 ciclos de PPU por scanline
 *   1 ciclo de CPU = 3 ciclos de PPU
 *
 * Registradores ($2000–$2007):
 *   $2000 PPUCTRL   $2001 PPUMASK   $2002 PPUSTATUS
 *   $2003 OAMADDR   $2004 OAMDATA   $2005 PPUSCROLL
 *   $2006 PPUADDR   $2007 PPUDATA
 */

// Paleta NES (64 cores RGB)
const NES_PALETTE = new Uint32Array([
    0xFF626262,0xFF002579,0xFF00107E,0xFF31007E,0xFF5F0066,0xFF720026,0xFF720000,0xFF5B1100,
    0xFF362600,0xFF093800,0xFF003F00,0xFF003B0C,0xFF003050,0xFF000000,0xFF000000,0xFF000000,
    0xFFABABAB,0xFF0A57C9,0xFF373DDA,0xFF6F22DA,0xFFA913BC,0xFFC81761,0xFFC82E00,0xFFA84200,
    0xFF705E00,0xFF387400,0xFF0B7D00,0xFF007840,0xFF006B90,0xFF000000,0xFF000000,0xFF000000,
    0xFFFFFFFF,0xFF55ACFF,0xFF8293FF,0xFFBC78FF,0xFFF06AFF,0xFFFF6DC9,0xFFFF7B6A,0xFFFF9000,
    0xFFCFAC00,0xFF96C700,0xFF65D300,0xFF4DD173,0xFF4DC4C9,0xFF4E4E4E,0xFF000000,0xFF000000,
    0xFFFFFFFF,0xFFB8DEFF,0xFFC5CAFF,0xFFDFC0FF,0xFFF7BCFF,0xFFFFBCE9,0xFFFFC4B9,0xFFFFCF97,
    0xFFF0DC84,0xFFD8EA93,0xFFBEF09C,0xFFB1EFC2,0xFFB1EBF2,0xFFB8B8B8,0xFF000000,0xFF000000,
]);

class PPU {
    constructor(nes) {
        this.nes = nes;

        // ── Memória interna ──
        this.vram    = new Uint8Array(2048);  // Nametables ($2000–$2FFF)
        this.palette = new Uint8Array(32);    // Paletas ($3F00–$3F1F)
        this.oam     = new Uint8Array(256);   // Object Attribute Memory (sprites)
        this.oam2    = new Uint8Array(32);    // Secondary OAM (8 sprites/scanline)

        // ── Registradores internos (Loopy) ──
        this.v = 0;    // Endereço VRAM atual       (15 bits)
        this.t = 0;    // Endereço VRAM temporário  (15 bits)
        this.x = 0;    // Fine X scroll             (3 bits)
        this.w = 0;    // Write toggle              (0 ou 1)

        // ── Registradores de controle ──
        this.ctrl   = 0;   // $2000 PPUCTRL
        this.mask   = 0;   // $2001 PPUMASK
        this.status = 0;   // $2002 PPUSTATUS

        this.oamAddr = 0;  // $2003 OAMADDR

        // ── Timing ──
        this.scanline = 261;  // Começa no pre-render
        this.dot      = 0;    // Ciclo dentro da scanline (0–340)
        this.frame    = 0;    // Número do frame (paridade afeta pulo)
        this.oddFrame = false;

        // ── Buffer de rendering ──
        this.frameBuffer = new Uint32Array(256 * 240); // ARGB

        // ── Latch de leitura $2007 ──
        this.readBuf = 0;

        // ── MMC3 IRQ: monitoramento do bit A12 ──
        this.lastA12 = 0;

        // ── Shift registers de background ──
        this.bgShiftLo = 0;
        this.bgShiftHi = 0;
        this.bgAttrLo  = 0;
        this.bgAttrHi  = 0;

        // ── Latches de tile fetch ──
        this.ntByte  = 0;
        this.atByte  = 0;
        this.tileLo  = 0;
        this.tileHi  = 0;

        // ── Sprites da scanline atual ──
        this.sprCount = 0;
        this.sprX     = new Uint8Array(8);
        this.sprAttr  = new Uint8Array(8);
        this.sprPatLo = new Uint8Array(8);
        this.sprPatHi = new Uint8Array(8);
        this.spr0Hit  = false;
    }

    // ─── Propriedades de controle ─────────────────────────────────────────────

    get renderingEnabled() { return !!(this.mask & 0x18); }
    get showBG()           { return !!(this.mask & 0x08); }
    get showSprites()      { return !!(this.mask & 0x10); }
    get showBGLeft()       { return !!(this.mask & 0x02); }
    get showSprLeft()      { return !!(this.mask & 0x04); }
    get nmiEnabled()       { return !!(this.ctrl & 0x80); }
    get bgPatternBase()    { return (this.ctrl & 0x10) ? 0x1000 : 0x0000; }
    get sprPatternBase()   { return (this.ctrl & 0x08) ? 0x1000 : 0x0000; }
    get sprHeight()        { return (this.ctrl & 0x20) ? 16 : 8; }
    get vramInc()          { return (this.ctrl & 0x04) ? 32 : 1; }

    // ─── Leitura de memória da PPU ────────────────────────────────────────────

    ppuRead(addr) {
        addr &= 0x3FFF;
        if (addr < 0x2000) return this.nes.rom.readCHR(addr);
        if (addr < 0x3F00) return this.vram[this._mirrorNT(addr) & 0x7FF];
        // Paleta
        addr &= 0x1F;
        if (addr === 0x10 || addr === 0x14 || addr === 0x18 || addr === 0x1C) addr &= 0x0F;
        return this.palette[addr];
    }

    ppuWrite(addr, val) {
        addr &= 0x3FFF;
        if (addr < 0x2000) { this.nes.rom.writeCHR(addr, val); return; }
        if (addr < 0x3F00) { this.vram[this._mirrorNT(addr) & 0x7FF] = val; return; }
        addr &= 0x1F;
        if (addr === 0x10 || addr === 0x14 || addr === 0x18 || addr === 0x1C) addr &= 0x0F;
        this.palette[addr] = val;
    }

    _mirrorNT(addr) {
        return this.nes.rom.mirrorAddr(addr);
    }

    // ─── Registradores CPU → PPU ($2000–$2007) ────────────────────────────────

    readReg(reg) {
        switch (reg) {
            case 2: { // PPUSTATUS
                const s = (this.status & 0xE0) | (this.readBuf & 0x1F);
                this.status &= ~0x80; // Limpa VBlank flag
                this.w = 0;
                return s;
            }
            case 4: return this.oam[this.oamAddr]; // OAMDATA
            case 7: { // PPUDATA
                let val = this.readBuf;
                this.readBuf = this.ppuRead(this.v);
                if ((this.v & 0x3FFF) >= 0x3F00) val = this.readBuf; // paleta: sem delay
                this.v = (this.v + this.vramInc) & 0x7FFF;
                return val;
            }
        }
        return 0;
    }

    writeReg(reg, val) {
        switch (reg) {
            case 0: // PPUCTRL
                this.ctrl = val;
                // t: NN bits
                this.t = (this.t & 0xF3FF) | ((val & 3) << 10);
                break;
            case 1: // PPUMASK
                this.mask = val;
                break;
            case 3: // OAMADDR
                this.oamAddr = val;
                break;
            case 4: // OAMDATA
                this.oam[this.oamAddr] = val;
                this.oamAddr = (this.oamAddr + 1) & 0xFF;
                break;
            case 5: // PPUSCROLL
                if (this.w === 0) {
                    this.t = (this.t & 0xFFE0) | (val >> 3);
                    this.x = val & 7;
                    this.w = 1;
                } else {
                    this.t = (this.t & 0x8FFF) | ((val & 7) << 12);
                    this.t = (this.t & 0xFC1F) | ((val & 0xF8) << 2);
                    this.w = 0;
                }
                break;
            case 6: // PPUADDR
                if (this.w === 0) {
                    this.t = (this.t & 0x00FF) | ((val & 0x3F) << 8);
                    this.w = 1;
                } else {
                    this.t = (this.t & 0xFF00) | val;
                    this.v = this.t;
                    this.w = 0;
                }
                break;
            case 7: // PPUDATA
                this.ppuWrite(this.v, val);
                this.v = (this.v + this.vramInc) & 0x7FFF;
                break;
        }
    }

    // ─── Tick (chamado 3x por ciclo de CPU) ──────────────────────────────────

    tick() {
        const sl  = this.scanline;
        const dot = this.dot;

        // ── VBlank ──
        if (sl === 241 && dot === 1) {
            this.status |= 0x80; // VBlank flag
            if (this.nmiEnabled) this.nes.cpu.nmiPending = true;
        }

        // ── Pre-render: limpa flags ──
        if (sl === 261 && dot === 1) {
            this.status &= ~0xE0; // limpa VBlank, S0, overflow
            this.spr0Hit = false;
        }

        // ── Rendering ──
        const rendering = this.renderingEnabled;

        if (rendering) {
            // Scanlines visíveis + pre-render
            if (sl < 240 || sl === 261) {
                this._renderCycle(sl, dot);
            }
        }

        // ── MMC3 IRQ — clocked uma vez por scanline no dot 260 ──────────────────
        // O hardware real usa a borda de subida do bit A12 do barramento da PPU.
        // A aproximação padrão: disparar no dot 260 (meio do fetch de sprites),
        // momento em que A12 tipicamente sobe para $1000 (sprite pattern table).
        // Isso garante 1 clock por scanline e timing correto para SMB3 e similares.
        if (dot === 260 && (sl < 240 || sl === 261) && rendering) {
            if (this.nes.rom.mapper === 4) {
                this.nes.rom.clockMMC3IRQ();
                if (this.nes.rom.mmc3.irqPending) {
                    this.nes.rom.mmc3.irqPending = false;
                    this.nes.cpu.irqPending = true;
                }
            }
        }

        // ── Avança timing ──
        this.dot++;
        if (this.dot === 341 || (this.dot === 340 && sl === 261 && this.oddFrame && rendering)) {
            this.dot = 0;
            this.scanline++;
            if (this.scanline > 261) {
                this.scanline = 0;
                this.frame++;
                this.oddFrame = !this.oddFrame;
            }
        }
    }

    // ─── Ciclo de Rendering ───────────────────────────────────────────────────

    _renderCycle(sl, dot) {
        const visible = sl < 240;
        const fetch   = (dot >= 1 && dot <= 256) || (dot >= 321 && dot <= 336);
        const sprEval = (dot >= 1 && dot <= 64) || (dot >= 65 && dot <= 256);

        // ── Pixel output (scanlines 0-239, dots 1-256) ──
        if (visible && dot >= 1 && dot <= 256) {
            this._renderPixel(sl, dot - 1);
        }

        // ── Sprite evaluation (scanlines 0-239) ──
        if (visible && dot === 257) {
            this._evalSprites(sl);
        }

        // ── Background fetch pipeline ──
        if (fetch) {
            // Shift registers avançam 1 bit por ciclo (mascarados a 16 bits para não overflow)
            this.bgShiftLo = (this.bgShiftLo << 1) & 0xFFFF;
            this.bgShiftHi = (this.bgShiftHi << 1) & 0xFFFF;
            // Atributo: replica o bit 0 para manter a paleta constante pelos 8 pixels do tile
            this.bgAttrLo  = ((this.bgAttrLo << 1) | (this.bgAttrLo & 1)) & 0xFFFF;
            this.bgAttrHi  = ((this.bgAttrHi << 1) | (this.bgAttrHi & 1)) & 0xFFFF;

            const cycle = dot & 7; // fase 0-7 dentro do tile de 8 pixels
            switch (cycle) {
                case 1: // Fetch nametable byte
                    this.ntByte = this.ppuRead(0x2000 | (this.v & 0x0FFF));
                    break;
                case 3: { // Fetch attribute byte
                    const atAddr = 0x23C0 | (this.v & 0x0C00) |
                                   ((this.v >> 4) & 0x38) | ((this.v >> 2) & 0x07);
                    const shift  = ((this.v >> 4) & 4) | (this.v & 2);
                    this.atByte  = (this.ppuRead(atAddr) >> shift) & 3;
                    break;
                }
                case 5: { // Fetch tile low plane
                    const fineY  = (this.v >> 12) & 7;
                    this.tileLo  = this.ppuRead(this.bgPatternBase + this.ntByte * 16 + fineY);
                    break;
                }
                case 7: { // Fetch tile high plane
                    const fineY  = (this.v >> 12) & 7;
                    this.tileHi  = this.ppuRead(this.bgPatternBase + this.ntByte * 16 + fineY + 8);
                    break;
                }
                case 0: // Load shift registers com os dados do próximo tile
                    this.bgShiftLo = (this.bgShiftLo & 0xFF00) | this.tileLo;
                    this.bgShiftHi = (this.bgShiftHi & 0xFF00) | this.tileHi;
                    // Carrega atributo como 8 bits idênticos (0x00 ou 0xFF por bit)
                    this.bgAttrLo  = (this.bgAttrLo & 0xFF00) | (this.atByte & 1 ? 0xFF : 0x00);
                    this.bgAttrHi  = (this.bgAttrHi & 0xFF00) | (this.atByte & 2 ? 0xFF : 0x00);
                    if (dot !== 0) this._incrCoarseX(); // dot=0 não incrementa
                    break;
            }
        }

        // Incrementa Y no final da linha visível
        if ((sl < 240 || sl === 261) && dot === 256) this._incrY();

        // Copia scroll horizontal de t para v
        if ((sl < 240 || sl === 261) && dot === 257) this._copyX();

        // Copia scroll vertical de t para v (apenas pre-render)
        if (sl === 261 && dot >= 280 && dot <= 304) this._copyY();
    }

    // ─── Renderiza pixel individual ───────────────────────────────────────────

    _renderPixel(sl, px) {
        let bgPixel  = 0;
        let bgPalette = 0;

        // Background
        if (this.showBG && (px >= 8 || this.showBGLeft)) {
            const bit    = 15 - this.x;
            const p0     = (this.bgShiftLo >> bit) & 1;
            const p1     = (this.bgShiftHi >> bit) & 1;
            bgPixel      = (p1 << 1) | p0;
            const a0     = (this.bgAttrLo >> bit) & 1;
            const a1     = (this.bgAttrHi >> bit) & 1;
            bgPalette    = (a1 << 1) | a0;
        }

        // Sprites
        let sprPixel   = 0;
        let sprPalette = 0;
        let sprPriority = 1;
        let isSpr0     = false;

        if (this.showSprites && (px >= 8 || this.showSprLeft)) {
            for (let i = 0; i < this.sprCount; i++) {
                let offset = px - this.sprX[i];
                if (offset < 0 || offset > 7) continue;
                offset = 7 - offset;
                const lo = (this.sprPatLo[i] >> offset) & 1;
                const hi = (this.sprPatHi[i] >> offset) & 1;
                const sp = (hi << 1) | lo;
                if (sp === 0) continue; // transparente
                sprPixel    = sp;
                sprPalette  = (this.sprAttr[i] & 3) + 4;
                sprPriority = (this.sprAttr[i] >> 5) & 1;
                isSpr0      = (i === 0);
                break;
            }
        }

        // Sprite 0 hit
        if (isSpr0 && bgPixel !== 0 && sprPixel !== 0 && px < 255) {
            this.status |= 0x40;
        }

        // Decide pixel final
        let finalPixel   = 0;
        let finalPalette = 0;

        if (bgPixel === 0 && sprPixel === 0) {
            finalPixel = 0; finalPalette = 0;
        } else if (bgPixel === 0) {
            finalPixel = sprPixel; finalPalette = sprPalette;
        } else if (sprPixel === 0) {
            finalPixel = bgPixel; finalPalette = bgPalette;
        } else {
            // Ambos não-transparentes → prioridade
            if (sprPriority === 0) {
                finalPixel = sprPixel; finalPalette = sprPalette;
            } else {
                finalPixel = bgPixel; finalPalette = bgPalette;
            }
        }

        const palIdx   = this.ppuRead(0x3F00 + finalPalette * 4 + finalPixel) & 0x3F;
        this.frameBuffer[sl * 256 + px] = NES_PALETTE[palIdx];
    }

    // ─── Evaluação de Sprites ─────────────────────────────────────────────────

    _evalSprites(sl) {
        this.sprCount = 0;
        const h = this.sprHeight;

        for (let i = 0; i < 64; i++) {
            const y = this.oam[i * 4];
            const row = sl - y;
            if (row < 0 || row >= h) continue;
            if (this.sprCount >= 8) {
                this.status |= 0x20; // Overflow
                break;
            }

            const tile  = this.oam[i * 4 + 1];
            const attr  = this.oam[i * 4 + 2];
            const x     = this.oam[i * 4 + 3];

            this.sprX[this.sprCount]    = x;
            this.sprAttr[this.sprCount] = attr;

            const flipV = !!(attr & 0x80);
            const flipH = !!(attr & 0x40);

            let r = flipV ? (h - 1 - row) : row;
            let base, tileIdx;

            if (h === 8) {
                base    = this.sprPatternBase;
                tileIdx = tile;
            } else {
                // 8x16: tile bit 0 = pattern table
                base    = (tile & 1) ? 0x1000 : 0x0000;
                tileIdx = tile & 0xFE;
                if (r >= 8) { tileIdx++; r -= 8; }
            }

            let lo = this.ppuRead(base + tileIdx * 16 + r);
            let hi = this.ppuRead(base + tileIdx * 16 + r + 8);

            if (flipH) {
                lo = this._reverseByte(lo);
                hi = this._reverseByte(hi);
            }

            this.sprPatLo[this.sprCount] = lo;
            this.sprPatHi[this.sprCount] = hi;
            this.sprCount++;
        }
    }

    _reverseByte(b) {
        b = ((b & 0xAA) >> 1) | ((b & 0x55) << 1);
        b = ((b & 0xCC) >> 2) | ((b & 0x33) << 2);
        b = ((b & 0xF0) >> 4) | ((b & 0x0F) << 4);
        return b;
    }

    // ─── Scroll Helpers (Loopy) ───────────────────────────────────────────────

    _incrCoarseX() {
        if ((this.v & 0x001F) === 31) {
            this.v &= ~0x001F;
            this.v ^=  0x0400; // flip nametable bit
        } else {
            this.v++;
        }
    }

    _incrY() {
        if ((this.v & 0x7000) !== 0x7000) {
            this.v += 0x1000; // incr fine Y
        } else {
            this.v &= ~0x7000;
            let y = (this.v >> 5) & 0x1F;
            if      (y === 29) { y = 0; this.v ^= 0x0800; }
            else if (y === 31) { y = 0; }
            else                { y++; }
            this.v = (this.v & ~0x03E0) | (y << 5);
        }
    }

    _copyX() {
        this.v = (this.v & 0xFBE0) | (this.t & 0x041F);
    }

    _copyY() {
        this.v = (this.v & 0x841F) | (this.t & 0x7BE0);
    }
}
