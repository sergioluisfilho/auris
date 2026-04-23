/**
 * NES Emulator - APU (Audio Processing Unit) - Stub
 *
 * Esta é uma implementação básica do APU que mantém o estado dos registradores
 * sem gerar áudio. Suficiente para que os jogos funcionem corretamente
 * (muitos fazem polling do registrador $4015).
 *
 * Para implementação de áudio completo: Etapa futura com Web Audio API.
 */

class APU {
    constructor(nes) {
        this.nes  = nes;
        this.regs = new Uint8Array(0x18); // $4000–$4017
        this.frameCounter = 0;
        this.cycles       = 0;
    }

    readStatus() {
        // $4015: status dos canais (simplificado)
        return 0x00;
    }

    writeReg(addr, val) {
        const reg = addr - 0x4000;
        if (reg >= 0 && reg < 0x18) {
            this.regs[reg] = val;
        }
    }

    tick(cpuCycles) {
        // Futuro: gerar amostras de áudio
    }
}
