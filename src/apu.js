/**
 * NES APU — Audio Processing Unit
 * Canais: Pulse 1, Pulse 2, Triangle, Noise, DMC
 * Frame Counter IRQ
 * Saída via Web Audio API (ScriptProcessorNode)
 */

// ── Tabelas de lookup (NES oficial) ────────────────────────────────────────

const LENGTH_TABLE = [
    10,254,20, 2,40, 4,80, 6,160, 8,60,10,14,12,26,14,
    12, 16,24,18,48,20,96,22,192,24,72,26,16,28,32,30
];

const DUTY_TABLE = [
    [0,1,0,0,0,0,0,0],
    [0,1,1,0,0,0,0,0],
    [0,1,1,1,1,0,0,0],
    [1,0,0,1,1,1,1,1],
];

const NOISE_PERIOD_TABLE = [
    4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068
];

const DMC_RATE_TABLE = [
    428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54
];

const TRIANGLE_SEQ = [
    15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0,
     0, 1, 2, 3, 4, 5,6,7,8,9,10,11,12,13,14,15
];

const CPU_FREQ = 1789773; // NTSC

// ── Envelope ────────────────────────────────────────────────────────────────

class Envelope {
    constructor() {
        this.start    = false;
        this.loop     = false;
        this.constant = false;
        this.volume   = 0;
        this.divider  = 0;
        this.decay    = 15;
    }
    write(val) {
        this.loop     = !!(val & 0x20);
        this.constant = !!(val & 0x10);
        this.volume   = val & 0x0F;
    }
    clock() {
        if (this.start) {
            this.start   = false;
            this.decay   = 15;
            this.divider = this.volume;
        } else {
            if (this.divider === 0) {
                this.divider = this.volume;
                if (this.decay === 0) {
                    if (this.loop) this.decay = 15;
                } else {
                    this.decay--;
                }
            } else {
                this.divider--;
            }
        }
    }
    output() {
        return this.constant ? this.volume : this.decay;
    }
}

// ── Sweep (Pulse só) ────────────────────────────────────────────────────────

class Sweep {
    constructor(ones) {
        this.ones    = ones; // true = pulse 1 (ones complement negate)
        this.enabled = false;
        this.period  = 0;
        this.negate  = false;
        this.shift   = 0;
        this.reload  = false;
        this.divider = 0;
    }
    write(val) {
        this.enabled = !!(val & 0x80);
        this.period  = (val >> 4) & 0x07;
        this.negate  = !!(val & 0x08);
        this.shift   = val & 0x07;
        this.reload  = true;
    }
    targetPeriod(timerPeriod) {
        const delta = timerPeriod >> this.shift;
        if (this.negate) return timerPeriod - delta - (this.ones ? 1 : 0);
        return timerPeriod + delta;
    }
    muting(timerPeriod) {
        return timerPeriod < 8 || this.targetPeriod(timerPeriod) > 0x7FF;
    }
    clock(channel) {
        const target = this.targetPeriod(channel.timerPeriod);
        if (this.divider === 0 && this.enabled && !this.muting(channel.timerPeriod)) {
            channel.timerPeriod = target;
        }
        if (this.divider === 0 || this.reload) {
            this.divider = this.period;
            this.reload  = false;
        } else {
            this.divider--;
        }
    }
}

// ── Pulse Channel ───────────────────────────────────────────────────────────

class PulseChannel {
    constructor(ones) {
        this.enabled     = false;
        this.duty        = 0;
        this.dutyPos     = 0;
        this.timerPeriod = 0;
        this.timer       = 0;
        this.lengthCount = 0;
        this.envelope    = new Envelope();
        this.sweep       = new Sweep(ones);
    }
    writeReg(reg, val) {
        switch (reg) {
            case 0:
                this.duty = (val >> 6) & 0x03;
                this.envelope.write(val);
                break;
            case 1:
                this.sweep.write(val);
                break;
            case 2:
                this.timerPeriod = (this.timerPeriod & 0x700) | val;
                break;
            case 3:
                this.timerPeriod = (this.timerPeriod & 0x0FF) | ((val & 0x07) << 8);
                if (this.enabled) this.lengthCount = LENGTH_TABLE[(val >> 3) & 0x1F];
                this.dutyPos = 0;
                this.envelope.start = true;
                break;
        }
    }
    clockTimer() {
        if (this.timer === 0) {
            this.timer   = this.timerPeriod;
            this.dutyPos = (this.dutyPos + 1) & 7;
        } else {
            this.timer--;
        }
    }
    clockLength() {
        if (!this.envelope.loop && this.lengthCount > 0) this.lengthCount--;
    }
    clockEnvelope()  { this.envelope.clock(); }
    clockSweep()     { this.sweep.clock(this); }
    output() {
        if (!this.enabled) return 0;
        if (this.lengthCount === 0) return 0;
        if (DUTY_TABLE[this.duty][this.dutyPos] === 0) return 0;
        if (this.sweep.muting(this.timerPeriod)) return 0;
        return this.envelope.output();
    }
}

// ── Triangle Channel ─────────────────────────────────────────────────────────

class TriangleChannel {
    constructor() {
        this.enabled       = false;
        this.timerPeriod   = 0;
        this.timer         = 0;
        this.lengthCount   = 0;
        this.linearCount   = 0;
        this.linearLoad    = 0;
        this.linearControl = false;
        this.linearHalt    = false;
        this.seqPos        = 0;
    }
    writeReg(reg, val) {
        switch (reg) {
            case 0:
                this.linearControl = !!(val & 0x80);
                this.linearLoad    = val & 0x7F;
                break;
            case 2:
                this.timerPeriod = (this.timerPeriod & 0x700) | val;
                break;
            case 3:
                this.timerPeriod = (this.timerPeriod & 0x0FF) | ((val & 0x07) << 8);
                if (this.enabled) this.lengthCount = LENGTH_TABLE[(val >> 3) & 0x1F];
                this.linearHalt = true;
                break;
        }
    }
    clockTimer() {
        if (this.timer === 0) {
            this.timer = this.timerPeriod;
            if (this.lengthCount > 0 && this.linearCount > 0) {
                this.seqPos = (this.seqPos + 1) & 31;
            }
        } else {
            this.timer--;
        }
    }
    clockLength() {
        if (!this.linearControl && this.lengthCount > 0) this.lengthCount--;
    }
    clockLinear() {
        if (this.linearHalt) {
            this.linearCount = this.linearLoad;
        } else if (this.linearCount > 0) {
            this.linearCount--;
        }
        if (!this.linearControl) this.linearHalt = false;
    }
    output() {
        if (!this.enabled) return 0;
        if (this.lengthCount === 0 || this.linearCount === 0) return 0;
        if (this.timerPeriod < 2) return 0; // ultrasonic suppression
        return TRIANGLE_SEQ[this.seqPos];
    }
}

// ── Noise Channel ────────────────────────────────────────────────────────────

class NoiseChannel {
    constructor() {
        this.enabled     = false;
        this.mode        = false;
        this.timerPeriod = NOISE_PERIOD_TABLE[0];
        this.timer       = 0;
        this.lengthCount = 0;
        this.shiftReg    = 1;
        this.envelope    = new Envelope();
    }
    writeReg(reg, val) {
        switch (reg) {
            case 0: this.envelope.write(val); break;
            case 2:
                this.mode        = !!(val & 0x80);
                this.timerPeriod = NOISE_PERIOD_TABLE[val & 0x0F];
                break;
            case 3:
                if (this.enabled) this.lengthCount = LENGTH_TABLE[(val >> 3) & 0x1F];
                this.envelope.start = true;
                break;
        }
    }
    clockTimer() {
        if (this.timer === 0) {
            this.timer = this.timerPeriod;
            const bit  = this.mode ? 6 : 1;
            const fb   = (this.shiftReg & 1) ^ ((this.shiftReg >> bit) & 1);
            this.shiftReg = (this.shiftReg >> 1) | (fb << 14);
        } else {
            this.timer--;
        }
    }
    clockLength()   { if (!this.envelope.loop && this.lengthCount > 0) this.lengthCount--; }
    clockEnvelope() { this.envelope.clock(); }
    output() {
        if (!this.enabled) return 0;
        if (this.lengthCount === 0) return 0;
        if (this.shiftReg & 1) return 0;
        return this.envelope.output();
    }
}

// ── DMC Channel ──────────────────────────────────────────────────────────────

class DMCChannel {
    constructor() {
        this.enabled     = false;
        this.irqEnabled  = false;
        this.loop        = false;
        this.ratePeriod  = DMC_RATE_TABLE[0];
        this.timer       = 0;
        this.outputLevel = 0;
        this.sampleAddr  = 0xC000;
        this.sampleLen   = 0;
        this.curAddr     = 0xC000;
        this.bytesLeft   = 0;
        this.sampleBuf   = 0;
        this.bufFull     = false;
        this.shiftReg    = 0;
        this.bitsLeft    = 0;
        this.silenced    = true;
        this.irqFlag     = false;
        this.readMem     = null; // set externally
    }
    writeReg(reg, val) {
        switch (reg) {
            case 0:
                this.irqEnabled = !!(val & 0x80);
                this.loop       = !!(val & 0x40);
                this.ratePeriod = DMC_RATE_TABLE[val & 0x0F];
                if (!this.irqEnabled) this.irqFlag = false;
                break;
            case 1:
                this.outputLevel = val & 0x7F;
                break;
            case 2:
                this.sampleAddr = 0xC000 + (val << 6);
                break;
            case 3:
                this.sampleLen = (val << 4) + 1;
                break;
        }
    }
    restart() {
        this.curAddr   = this.sampleAddr;
        this.bytesLeft = this.sampleLen;
    }
    _fillBuffer() {
        if (!this.bufFull && this.bytesLeft > 0 && this.readMem) {
            this.sampleBuf = this.readMem(this.curAddr);
            this.curAddr   = (this.curAddr + 1) | 0x8000;
            this.bytesLeft--;
            this.bufFull   = true;
            if (this.bytesLeft === 0) {
                if (this.loop) { this.restart(); }
                else if (this.irqEnabled) { this.irqFlag = true; }
            }
        }
    }
    clockTimer() {
        this._fillBuffer();
        if (this.timer === 0) {
            this.timer = this.ratePeriod;
            if (!this.silenced) {
                if (this.shiftReg & 1) {
                    if (this.outputLevel <= 125) this.outputLevel += 2;
                } else {
                    if (this.outputLevel >= 2)   this.outputLevel -= 2;
                }
            }
            this.shiftReg >>= 1;
            this.bitsLeft--;
            if (this.bitsLeft === 0) {
                this.bitsLeft = 8;
                if (this.bufFull) {
                    this.silenced = false;
                    this.shiftReg = this.sampleBuf;
                    this.bufFull  = false;
                } else {
                    this.silenced = true;
                }
            }
        } else {
            this.timer--;
        }
    }
    output() {
        return this.enabled ? this.outputLevel : 0;
    }
}

// ── APU Principal ─────────────────────────────────────────────────────────────

class APU {
    constructor(nes) {
        this.nes    = nes;
        this.pulse1 = new PulseChannel(true);
        this.pulse2 = new PulseChannel(false);
        this.tri    = new TriangleChannel();
        this.noise  = new NoiseChannel();
        this.dmc    = new DMCChannel();

        // Frame counter
        this.frameMode      = 0; // 0=4-step, 1=5-step
        this.frameIrqEnable = true;
        this.frameIrqFlag   = false;
        this.frameCycles    = 0;
        this.frameStep      = 0;

        // 4-step frame clock points (CPU cycles)
        this.FRAME_STEPS_4 = [3728, 7456, 11185, 14914];
        this.FRAME_STEPS_5 = [3728, 7456, 11185, 14914, 18640];

        // Audio
        this.audioCtx    = null;
        this.scriptNode  = null;
        this.gainNode    = null;
        this.muted       = false;

        this.sampleRate  = 44100;
        this.cyclesPerSample = CPU_FREQ / this.sampleRate;
        this.cycleAccum  = 0;

        // Ring buffer (small enough for low latency)
        this.BUF_SIZE    = 4096;
        this.audioBuf    = new Float32Array(this.BUF_SIZE);
        this.bufWrite    = 0;
        this.bufRead     = 0;
    }

    // Chamado pelo NES.js após construção
    setMemReader(fn) {
        this.dmc.readMem = fn;
    }

    // Inicializa Web Audio (deve ser chamado após gesto do usuário)
    init(ctx) {
        if (this.audioCtx) return;
        this.audioCtx   = ctx;
        this.sampleRate = ctx.sampleRate;
        this.cyclesPerSample = CPU_FREQ / this.sampleRate;

        this.gainNode   = ctx.createGain();
        this.gainNode.gain.value = 0.8;
        this.gainNode.connect(ctx.destination);

        const bufSize    = 512;
        this.scriptNode  = ctx.createScriptProcessor(bufSize, 0, 1);
        this.scriptNode.onaudioprocess = (e) => {
            const out = e.outputBuffer.getChannelData(0);
            for (let i = 0; i < out.length; i++) {
                if (this.bufRead !== this.bufWrite) {
                    out[i] = this.audioBuf[this.bufRead];
                    this.bufRead = (this.bufRead + 1) % this.BUF_SIZE;
                } else {
                    out[i] = 0;
                }
            }
        };
        this.scriptNode.connect(this.gainNode);
    }

    setMute(muted) {
        this.muted = muted;
        if (this.gainNode) {
            this.gainNode.gain.value = muted ? 0 : 0.8;
        }
    }

    // ── Registradores ────────────────────────────────────────────────────────

    readStatus() {
        let s = 0;
        if (this.pulse1.lengthCount > 0) s |= 0x01;
        if (this.pulse2.lengthCount > 0) s |= 0x02;
        if (this.tri.lengthCount   > 0) s |= 0x04;
        if (this.noise.lengthCount > 0) s |= 0x08;
        if (this.dmc.bytesLeft     > 0) s |= 0x10;
        if (this.frameIrqFlag)          s |= 0x40;
        if (this.dmc.irqFlag)           s |= 0x80;
        this.frameIrqFlag = false;
        return s;
    }

    writeReg(addr, val) {
        if (addr >= 0x4000 && addr <= 0x4003) { this.pulse1.writeReg(addr - 0x4000, val); return; }
        if (addr >= 0x4004 && addr <= 0x4007) { this.pulse2.writeReg(addr - 0x4004, val); return; }
        if (addr >= 0x4008 && addr <= 0x400B) { this.tri.writeReg(addr - 0x4008, val);   return; }
        if (addr >= 0x400C && addr <= 0x400F) { this.noise.writeReg(addr - 0x400C, val); return; }
        if (addr >= 0x4010 && addr <= 0x4013) { this.dmc.writeReg(addr - 0x4010, val);   return; }

        if (addr === 0x4015) {
            this.pulse1.enabled = !!(val & 0x01); if (!this.pulse1.enabled) this.pulse1.lengthCount = 0;
            this.pulse2.enabled = !!(val & 0x02); if (!this.pulse2.enabled) this.pulse2.lengthCount = 0;
            this.tri.enabled    = !!(val & 0x04); if (!this.tri.enabled)    this.tri.lengthCount    = 0;
            this.noise.enabled  = !!(val & 0x08); if (!this.noise.enabled)  this.noise.lengthCount  = 0;
            this.dmc.irqFlag    = false;
            if (val & 0x10) {
                this.dmc.enabled = true;
                if (this.dmc.bytesLeft === 0) this.dmc.restart();
            } else {
                this.dmc.enabled = false;
                this.dmc.bytesLeft = 0;
            }
            return;
        }

        if (addr === 0x4017) {
            this.frameMode      = (val >> 7) & 1;
            this.frameIrqEnable = !(val & 0x40);
            this.frameCycles    = 0;
            this.frameStep      = 0;
            if (!this.frameIrqEnable) this.frameIrqFlag = false;
            if (this.frameMode === 1) this._clockHalf(); // 5-step: clock immediately
        }
    }

    // ── Frame Counter ────────────────────────────────────────────────────────

    _clockEnvelopes() {
        this.pulse1.clockEnvelope();
        this.pulse2.clockEnvelope();
        this.tri.clockLinear();
        this.noise.clockEnvelope();
    }

    _clockHalf() {
        this._clockEnvelopes();
        this.pulse1.clockLength(); this.pulse1.clockSweep();
        this.pulse2.clockLength(); this.pulse2.clockSweep();
        this.tri.clockLength();
        this.noise.clockLength();
    }

    _tickFrameCounter(cpuCycles) {
        this.frameCycles += cpuCycles;
        const steps = this.frameMode === 0 ? this.FRAME_STEPS_4 : this.FRAME_STEPS_5;
        const period = this.frameMode === 0 ? 14915 : 18641;

        while (this.frameCycles >= steps[this.frameStep]) {
            const step = this.frameStep;
            const last = steps.length - 1;
            if (step === 1 || step === last) {
                this._clockHalf();
            } else {
                this._clockEnvelopes();
            }
            if (this.frameMode === 0 && step === last && this.frameIrqEnable) {
                this.frameIrqFlag = true;
                if (this.nes && this.nes.cpu) this.nes.cpu.requestIRQ();
            }
            this.frameStep++;
            if (this.frameStep >= steps.length) {
                this.frameStep   = 0;
                this.frameCycles -= period;
            }
        }
    }

    // ── Mixer ────────────────────────────────────────────────────────────────

    _mix() {
        const p1  = this.pulse1.output();
        const p2  = this.pulse2.output();
        const tri = this.tri.output();
        const noi = this.noise.output();
        const dmc = this.dmc.output();

        const pulseOut = (p1 + p2 === 0) ? 0 : 95.88 / (8128 / (p1 + p2) + 100);
        const tndDen   = tri / 8227 + noi / 12241 + dmc / 22638;
        const tndOut   = tndDen === 0 ? 0 : 159.79 / (1 / tndDen + 100);

        return pulseOut + tndOut; // 0.0 – ~1.0
    }

    // ── Tick principal ───────────────────────────────────────────────────────

    tick(cpuCycles) {
        if (!this.audioCtx) return;

        this._tickFrameCounter(cpuCycles);

        // Clock timers (triangle clocked every CPU cycle, others every 2)
        for (let c = 0; c < cpuCycles; c++) {
            this.tri.clockTimer();
            if (c & 1) {
                this.pulse1.clockTimer();
                this.pulse2.clockTimer();
                this.noise.clockTimer();
                this.dmc.clockTimer();
            }
        }

        // Gerar samples de audio
        this.cycleAccum += cpuCycles;
        while (this.cycleAccum >= this.cyclesPerSample) {
            this.cycleAccum -= this.cyclesPerSample;
            const sample = this._mix();
            const next   = (this.bufWrite + 1) % this.BUF_SIZE;
            if (next !== this.bufRead) { // nunca sobrescreve dados não lidos
                this.audioBuf[this.bufWrite] = sample;
                this.bufWrite = next;
            }
        }
    }

    reset() {
        this.pulse1 = new PulseChannel(true);
        this.pulse2 = new PulseChannel(false);
        this.tri    = new TriangleChannel();
        this.noise  = new NoiseChannel();
        this.dmc    = new DMCChannel();
        this.dmc.readMem    = this._savedMemReader || null;
        this.frameCycles    = 0;
        this.frameStep      = 0;
        this.frameIrqFlag   = false;
        this.cycleAccum     = 0;
        this.bufWrite       = 0;
        this.bufRead        = 0;
    }
}
