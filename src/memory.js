/**
 * NES Emulator - Barramento de Memória
 *
 * Mapa de memória da CPU ($0000–$FFFF):
 *   $0000–$07FF  RAM interna (2KB), espelhada até $1FFF
 *   $2000–$2007  Registradores da PPU, espelhados até $3FFF
 *   $4000–$4017  APU e I/O (controles em $4016/$4017)
 *   $4018–$401F  Registradores extras (desabilitados)
 *   $4020–$FFFF  Espaço da cartridge (ROM/Mapper)
 */

class Memory {
    constructor(nes) {
        this.nes = nes;
        this.ram = new Uint8Array(2048);   // $0000–$07FF

        // Estado do controlador (latch serial)
        this.ctrl1Latch  = 0;
        this.ctrl2Latch  = 0;
        this.ctrl1Index  = 0;
        this.ctrl2Index  = 0;
        this.ctrlStrobe  = 0;
    }

    // ─── Leitura ───────────────────────────────────────────────────────────────

    read(addr) {
        addr &= 0xFFFF;

        // RAM interna (espelhada a cada 2KB)
        if (addr < 0x2000) return this.ram[addr & 0x07FF];

        // Registradores PPU ($2000–$3FFF, espelhados a cada 8 bytes)
        if (addr < 0x4000) return this.nes.ppu.readReg(addr & 0x0007);

        // APU / I/O
        if (addr < 0x4020) return this._readIO(addr);

        // Cartridge (PRG ROM via mapper)
        if (addr >= 0x8000) return this.nes.rom.readPRG(addr);

        // PRG RAM ($6000–$7FFF) — battery-backed
        if (addr >= 0x6000) return this.nes.prgRAM[addr - 0x6000];

        return 0;
    }

    // ─── Escrita ───────────────────────────────────────────────────────────────

    write(addr, val) {
        addr &= 0xFFFF;
        val  &= 0xFF;

        if (addr < 0x2000) { this.ram[addr & 0x07FF] = val; return; }

        if (addr < 0x4000) { this.nes.ppu.writeReg(addr & 0x0007, val); return; }

        if (addr < 0x4020) { this._writeIO(addr, val); return; }

        if (addr >= 0x8000) { this.nes.rom.writePRG(addr, val); return; }

        if (addr >= 0x6000) { this.nes.prgRAM[addr - 0x6000] = val; return; }
    }

    // ─── I/O ($4000–$401F) ────────────────────────────────────────────────────

    _readIO(addr) {
        switch (addr) {
            case 0x4015: return this.nes.apu.readStatus();
            case 0x4016: return this._readController(1);
            case 0x4017: return this._readController(2);
            default:     return 0;
        }
    }

    _writeIO(addr, val) {
        // APU registers
        if (addr <= 0x4013 || addr === 0x4015 || addr === 0x4017) {
            this.nes.apu.writeReg(addr, val);
            return;
        }

        switch (addr) {
            case 0x4014: // OAM DMA
                this._oamDMA(val);
                break;
            case 0x4016: // Controller strobe
                this._writeStrobe(val);
                break;
        }
    }

    // ─── OAM DMA ─────────────────────────────────────────────────────────────

    _oamDMA(page) {
        const base = page << 8;
        for (let i = 0; i < 256; i++) {
            this.nes.ppu.oam[this.nes.ppu.oamAddr] = this.read(base + i);
            this.nes.ppu.oamAddr = (this.nes.ppu.oamAddr + 1) & 0xFF;
        }
        // Adiciona ciclos de stall na CPU (513 ou 514 dependendo do ciclo atual)
        this.nes.cpu.stallCycles += 513 + (this.nes.cpu.cycles & 1);
    }

    // ─── Controladores ────────────────────────────────────────────────────────

    _writeStrobe(val) {
        this.ctrlStrobe = val & 1;
        if (this.ctrlStrobe) {
            // Enquanto strobe=1, latch sempre atualizado
            this.ctrl1Latch = this.nes.input.getButtons(1);
            this.ctrl2Latch = this.nes.input.getButtons(2);
            this.ctrl1Index = 0;
            this.ctrl2Index = 0;
        }
    }

    _readController(num) {
        if (this.ctrlStrobe) {
            return (num === 1 ? this.nes.input.getButtons(1) : this.nes.input.getButtons(2)) & 1;
        }
        let latch, index;
        if (num === 1) {
            if (this.ctrl1Index >= 8) return 1;
            const bit = (this.ctrl1Latch >> this.ctrl1Index) & 1;
            this.ctrl1Index++;
            return bit;
        } else {
            if (this.ctrl2Index >= 8) return 1;
            const bit = (this.ctrl2Latch >> this.ctrl2Index) & 1;
            this.ctrl2Index++;
            return bit;
        }
    }

    // Atualiza latch (chamado a cada frame quando strobe=0)
    latchControllers() {
        if (!this.ctrlStrobe) {
            this.ctrl1Latch = this.nes.input.getButtons(1);
            this.ctrl2Latch = this.nes.input.getButtons(2);
            this.ctrl1Index = 0;
            this.ctrl2Index = 0;
        }
    }
}
