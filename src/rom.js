/**
 * NES Emulator - ROM Loader
 * Parser do formato iNES (.nes) — suporta Mapper 0 (NROM) e Mapper 1 (MMC1)
 *
 * Formato iNES:
 *   Bytes 0-3:  "NES\x1A" (magic)
 *   Byte 4:     Número de blocos de 16KB de PRG ROM
 *   Byte 5:     Número de blocos de 8KB de CHR ROM (0 = CHR RAM)
 *   Byte 6:     Flags 6  (mapper baixo, espelhamento, bateria, trainer)
 *   Byte 7:     Flags 7  (mapper alto, NES 2.0)
 *   Bytes 8-15: Ignorados (PRG RAM size, TV system, etc.)
 *   Depois: [Trainer 512B se flag] [PRG ROM] [CHR ROM]
 */

class ROM {
    constructor() {
        this.prgROM   = null;  // Uint8Array - Program ROM
        this.chrROM   = null;  // Uint8Array - Character ROM (tiles)
        this.chrRAM   = null;  // Uint8Array - Character RAM (se chrROM=0)

        this.mapper   = 0;     // Número do mapper
        this.mirror   = 0;     // 0=horizontal, 1=vertical, 4=four-screen
        this.hasBattery = false;

        this.prgBanks = 0;     // Número de bancos de 16KB
        this.chrBanks = 0;     // Número de bancos de 8KB

        // Mapper 1 (MMC1) state
        this.mmc1 = {
            shift: 0x10,       // Shift register (bit 4 = flag reset)
            control: 0x0C,     // PPUCTRL default
            chrBank0: 0,
            chrBank1: 0,
            prgBank: 0,
        };

        // Mapper 2 (UxROM) state
        this.mmc2PrgBank = 0;
    }

    load(buffer) {
        const data = new Uint8Array(buffer);

        // Validar magic
        if (data[0] !== 0x4E || data[1] !== 0x45 ||
            data[2] !== 0x53 || data[3] !== 0x1A) {
            throw new Error('Arquivo inválido: não é um ROM iNES (.nes)');
        }

        this.prgBanks = data[4];
        this.chrBanks = data[5];

        const flags6 = data[6];
        const flags7 = data[7];

        this.mirror     = (flags6 & 0x08) ? 4 : (flags6 & 0x01);
        this.hasBattery = !!(flags6 & 0x02);
        const hasTrainer = !!(flags6 & 0x04);

        this.mapper = ((flags7 & 0xF0) | (flags6 >> 4));

        const prgSize = this.prgBanks * 16384;
        const chrSize = this.chrBanks * 8192;

        let offset = 16;
        if (hasTrainer) offset += 512;

        this.prgROM = data.slice(offset, offset + prgSize);
        offset += prgSize;

        if (this.chrBanks > 0) {
            this.chrROM = data.slice(offset, offset + chrSize);
        } else {
            // CHR RAM - 8KB
            this.chrRAM = new Uint8Array(8192);
            this.chrROM = this.chrRAM;
        }

        console.log(`[ROM] Carregado: PRG=${this.prgBanks}x16KB, CHR=${this.chrBanks}x8KB, Mapper=${this.mapper}, Mirror=${['H','V','','','4-screen'][this.mirror]||this.mirror}`);

        if (![0, 1, 2, 3, 4].includes(this.mapper)) {
            console.warn(`[ROM] Mapper ${this.mapper} não totalmente suportado — pode não funcionar.`);
        }
    }

    // ─── Leitura PRG ROM ──────────────────────────────────────────────────────

    readPRG(addr) {
        // addr: $8000–$FFFF
        switch (this.mapper) {
            case 0: return this._readPRGMapper0(addr);
            case 1: return this._readPRGMapper1(addr);
            case 2: return this._readPRGMapper2(addr);
            case 3: return this._readPRGMapper3(addr);
            case 4: return this._readPRGMapper4(addr);
            default: return this._readPRGMapper0(addr);
        }
    }

    writePRG(addr, val) {
        switch (this.mapper) {
            case 1: this._writePRGMapper1(addr, val); break;
            case 2: this._writePRGMapper2(addr, val); break;
            case 3: this._writePRGMapper3(addr, val); break;
            case 4: this._writePRGMapper4(addr, val); break;
        }
    }

    // ─── Leitura CHR ROM / RAM ────────────────────────────────────────────────

    readCHR(addr) {
        addr &= 0x1FFF;
        switch (this.mapper) {
            case 1: return this._readCHRMapper1(addr);
            case 4: return this._readCHRMapper4(addr);
            default: return this.chrROM[addr % this.chrROM.length];
        }
    }

    writeCHR(addr, val) {
        if (this.chrRAM) this.chrRAM[addr & 0x1FFF] = val;
    }

    // ─── Mapper 0: NROM ───────────────────────────────────────────────────────

    _readPRGMapper0(addr) {
        addr -= 0x8000;
        if (this.prgBanks === 1) addr &= 0x3FFF; // mirror
        return this.prgROM[addr];
    }

    // ─── Mapper 1: MMC1 ───────────────────────────────────────────────────────

    _writePRGMapper1(addr, val) {
        const m = this.mmc1;
        if (val & 0x80) {
            m.shift   = 0x10;
            m.control |= 0x0C;
            return;
        }
        const done = m.shift & 1;
        m.shift = ((m.shift >> 1) | ((val & 1) << 4)) & 0x1F;
        if (!done) return;
        const data  = m.shift;
        m.shift     = 0x10;
        if      (addr < 0xA000) m.control  = data;
        else if (addr < 0xC000) m.chrBank0 = data;
        else if (addr < 0xE000) m.chrBank1 = data;
        else                    m.prgBank  = data & 0x0F;
    }

    _readPRGMapper1(addr) {
        const m      = this.mmc1;
        const mode   = (m.control >> 2) & 3;
        const bank   = m.prgBank;
        const banks  = this.prgBanks;
        let a;
        if (mode <= 1) {
            // 32KB switch
            a = ((bank >> 1) * 0x8000 + (addr - 0x8000)) % this.prgROM.length;
        } else if (mode === 2) {
            // fix first, switch last
            if (addr < 0xC000) a = addr - 0x8000;
            else                a = (bank * 0x4000 + addr - 0xC000) % this.prgROM.length;
        } else {
            // switch first, fix last
            if (addr < 0xC000) a = (bank * 0x4000 + addr - 0x8000) % this.prgROM.length;
            else                a = ((banks - 1) * 0x4000 + addr - 0xC000) % this.prgROM.length;
        }
        return this.prgROM[a];
    }

    _readCHRMapper1(addr) {
        const m    = this.mmc1;
        const mode = (m.control >> 4) & 1;
        if (mode === 0) {
            // 8KB mode
            const bank = (m.chrBank0 >> 1) * 0x2000;
            return this.chrROM[(bank + addr) % this.chrROM.length];
        } else {
            // 4KB mode
            if (addr < 0x1000) return this.chrROM[(m.chrBank0 * 0x1000 + addr) % this.chrROM.length];
            else                return this.chrROM[(m.chrBank1 * 0x1000 + addr - 0x1000) % this.chrROM.length];
        }
    }

    // ─── Mapper 2: UxROM ──────────────────────────────────────────────────────

    _writePRGMapper2(addr, val) { this.mmc2PrgBank = val & 0x0F; }
    _readPRGMapper2(addr) {
        if (addr < 0xC000) return this.prgROM[(this.mmc2PrgBank * 0x4000 + addr - 0x8000) % this.prgROM.length];
        return this.prgROM[((this.prgBanks - 1) * 0x4000 + addr - 0xC000) % this.prgROM.length];
    }

    // ─── Mapper 3: CNROM ──────────────────────────────────────────────────────

    _chrBank3 = 0;
    _writePRGMapper3(addr, val) { this._chrBank3 = val & 3; }
    _readPRGMapper3(addr) { return this._readPRGMapper0(addr); }

    // ─── Mapper 4: MMC3 (Nintendo MMC3) ──────────────────────────────────────
    //
    // PRG ROM banking: 4 regiões de 8KB ($8000/$A000/$C000/$E000)
    //   R6 = banco switchable em $8000 (modo 0) ou $C000 (modo 1)
    //   R7 = banco switchable em $A000 (sempre)
    //   Segundo-ao-último banco fixo em modo alternativo
    //   Último banco sempre fixo em $E000
    //
    // CHR ROM banking: 8 regiões de 1KB ($0000–$1FFF)
    //   Modo 0: R0 (2KB) / R1 (2KB) / R2-R5 (1KB cada)
    //   Modo 1: R2-R5 (1KB cada) / R0 (2KB) / R1 (2KB)
    //
    // IRQ: contador decrementado a cada transição de A12 da PPU (aprox. por scanline)

    mmc3 = {
        reg:        new Uint8Array(8),
        command:    0,
        prgMode:    0,
        chrMode:    0,
        irqReload:  0,
        irqCounter: 0,
        irqEnable:  false,
        irqPending: false,
        lastA12:    0,      // estado anterior do bit 12 da PPU
    };

    _writePRGMapper4(addr, val) {
        const m = this.mmc3;
        if (addr < 0xA000) {
            if (addr & 1) {
                m.reg[m.command & 7] = val;
            } else {
                m.command = val;
                m.prgMode = (val >> 6) & 1;
                m.chrMode = (val >> 7) & 1;
            }
        } else if (addr < 0xC000) {
            // Mirroring ($A000-$BFFE par) / PRG RAM protect ($A001-$BFFF ímpar)
            // BUG FIX: bit MMC3 e convenção interna são invertidos!
            // MMC3 bit=0 → "vertical" (NTs lado a lado) → scroll horizontal → mirror=1 (A B A B)
            // MMC3 bit=1 → "horizontal" (NTs empilhados) → scroll vertical  → mirror=0 (A A B B)
            if (!(addr & 1)) this.mirror = (val & 1) ? 0 : 1;
        } else if (addr < 0xE000) {
            // IRQ latch ($C000 par) / IRQ reload ($C001 ímpar)
            if (!(addr & 1)) {
                m.irqReload = val;
            } else {
                m.irqCounter = 0;  // força reload no próximo clock
            }
        } else {
            // IRQ disable ($E000 par) / IRQ enable ($E001 ímpar)
            m.irqEnable = !!(addr & 1);
            if (!m.irqEnable) m.irqPending = false;
        }
    }

    _readPRGMapper4(addr) {
        const m     = this.mmc3;
        const banks = this.prgBanks * 2; // unidades de 8KB
        const off   = addr & 0x1FFF;
        let bank;

        if      (addr < 0xA000) bank = m.prgMode === 0 ? m.reg[6]  : banks - 2;
        else if (addr < 0xC000) bank = m.reg[7];
        else if (addr < 0xE000) bank = m.prgMode === 0 ? banks - 2 : m.reg[6];
        else                    bank = banks - 1;

        return this.prgROM[(bank % banks) * 0x2000 + off];
    }

    // CHR banking MMC3 — BUG CRÍTICO CORRIGIDO
    // SMB3 tem 16 bancos de CHR de 8KB = 128 bancos de 1KB
    // Sem isso, todos os tiles são lidos do início da CHR ROM → tela preta / gráficos corrompidos
    _readCHRMapper4(addr) {
        const m      = this.mmc3;
        const banks1k = this.chrBanks * 8; // número total de bancos de 1KB
        let chrAddr;

        if (m.chrMode === 0) {
            // Modo 0:
            //   $0000–$07FF → R0 (2KB, bit0 ignorado)
            //   $0800–$0FFF → R1 (2KB, bit0 ignorado)
            //   $1000–$13FF → R2 (1KB)
            //   $1400–$17FF → R3 (1KB)
            //   $1800–$1BFF → R4 (1KB)
            //   $1C00–$1FFF → R5 (1KB)
            if (addr < 0x0800) {
                chrAddr = (m.reg[0] & 0xFE) * 0x400 + (addr & 0x7FF);
            } else if (addr < 0x1000) {
                chrAddr = (m.reg[1] & 0xFE) * 0x400 + (addr & 0x7FF);
            } else {
                const region = (addr - 0x1000) >> 10; // 0-3
                chrAddr = m.reg[2 + region] * 0x400 + (addr & 0x3FF);
            }
        } else {
            // Modo 1:
            //   $0000–$03FF → R2 (1KB)
            //   $0400–$07FF → R3 (1KB)
            //   $0800–$0BFF → R4 (1KB)
            //   $0C00–$0FFF → R5 (1KB)
            //   $1000–$17FF → R0 (2KB, bit0 ignorado)
            //   $1800–$1FFF → R1 (2KB, bit0 ignorado)
            if (addr < 0x1000) {
                const region = addr >> 10; // 0-3
                chrAddr = m.reg[2 + region] * 0x400 + (addr & 0x3FF);
            } else if (addr < 0x1800) {
                chrAddr = (m.reg[0] & 0xFE) * 0x400 + (addr & 0x7FF);
            } else {
                chrAddr = (m.reg[1] & 0xFE) * 0x400 + (addr & 0x7FF);
            }
        }

        return this.chrROM[chrAddr % this.chrROM.length];
    }

    // Chamado pela PPU a cada transição de A12 (0→1) — aciona IRQ do MMC3
    // SMB3 usa isso para criar o efeito de barra de status (split-screen)
    clockMMC3IRQ() {
        const m = this.mmc3;
        if (m.irqCounter === 0) {
            m.irqCounter = m.irqReload;
        } else {
            m.irqCounter--;
        }
        if (m.irqCounter === 0 && m.irqEnable) {
            m.irqPending = true;
        }
    }

    // ─── Espelhamento de Nametable ────────────────────────────────────────────

    mirrorAddr(addr) {
        addr = (addr - 0x2000) & 0x0FFF;
        const table = addr >> 10;  // 0–3
        const offset = addr & 0x3FF;
        let physTable;
        switch (this.mirror) {
            case 0: // Horizontal: A A B B
                physTable = table < 2 ? 0 : 1;
                break;
            case 1: // Vertical: A B A B
                physTable = table & 1;
                break;
            case 4: // Four-screen (sem mirror real)
                physTable = table;
                break;
            default:
                physTable = 0;
        }
        return 0x2000 + physTable * 0x400 + offset;
    }
}
