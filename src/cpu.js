/**
 * NES Emulator - CPU 6502
 * Implementação completa do processador MOS 6502 usado no NES
 * Inclui todos os opcodes oficiais, modos de endereçamento e ciclos corretos
 */

class CPU {
    constructor() {
        // === Registradores ===
        this.A  = 0;      // Acumulador
        this.X  = 0;      // Registrador X
        this.Y  = 0;      // Registrador Y
        this.SP = 0xFD;   // Stack Pointer ($01xx)
        this.PC = 0;      // Program Counter

        // === Flags de Status (P) ===
        this.C = 0;  // Carry
        this.Z = 0;  // Zero
        this.I = 1;  // Interrupt Disable
        this.D = 0;  // Decimal (não usado no NES)
        this.B = 0;  // Break
        this.V = 0;  // Overflow
        this.N = 0;  // Negative

        this.cycles     = 0;  // Ciclos totais executados
        this.stallCycles = 0; // Ciclos extras para DMA OAM

        this.mem = null; // Referência ao barramento de memória (Memory)

        // Interrupções pendentes
        this.nmiPending = false;
        this.irqPending = false;
    }

    // ─── Status Register ───────────────────────────────────────────────────────

    getP() {
        return  (this.C)        |
                (this.Z << 1)   |
                (this.I << 2)   |
                (this.D << 3)   |
                (this.B << 4)   |
                (1   << 5)      |  // bit 5 sempre 1
                (this.V << 6)   |
                (this.N << 7);
    }

    setP(p) {
        this.C = (p >> 0) & 1;
        this.Z = (p >> 1) & 1;
        this.I = (p >> 2) & 1;
        this.D = (p >> 3) & 1;
        this.B = (p >> 4) & 1;
        this.V = (p >> 6) & 1;
        this.N = (p >> 7) & 1;
    }

    // ─── Stack ─────────────────────────────────────────────────────────────────

    push(val) {
        this.mem.write(0x100 + this.SP, val & 0xFF);
        this.SP = (this.SP - 1) & 0xFF;
    }

    pop() {
        this.SP = (this.SP + 1) & 0xFF;
        return this.mem.read(0x100 + this.SP);
    }

    push16(val) {
        this.push((val >> 8) & 0xFF);
        this.push(val & 0xFF);
    }

    pop16() {
        const lo = this.pop();
        const hi = this.pop();
        return (hi << 8) | lo;
    }

    // ─── Utilidades ────────────────────────────────────────────────────────────

    setZN(val) {
        this.Z = (val === 0) ? 1 : 0;
        this.N = (val >> 7) & 1;
    }

    // Leitura 16-bit little-endian
    read16(addr) {
        const lo = this.mem.read(addr & 0xFFFF);
        const hi = this.mem.read((addr + 1) & 0xFFFF);
        return (hi << 8) | lo;
    }

    // Leitura 16-bit com bug de página (JMP indirect)
    read16bug(addr) {
        const lo = this.mem.read(addr);
        const hi = this.mem.read((addr & 0xFF00) | ((addr + 1) & 0xFF));
        return (hi << 8) | lo;
    }

    // ─── Inicialização / Reset ─────────────────────────────────────────────────

    reset() {
        this.PC = this.read16(0xFFFC);
        this.SP = 0xFD;
        this.setP(0x24);  // I=1
        this.cycles = 0;
    }

    // ─── Interrupções ──────────────────────────────────────────────────────────

    triggerNMI() {
        this.push16(this.PC);
        this.push(this.getP() & ~0x10); // B=0
        this.I = 1;
        this.PC = this.read16(0xFFFA);
        this.cycles += 7;
    }

    triggerIRQ() {
        if (this.I) return;
        this.push16(this.PC);
        this.push(this.getP() & ~0x10);
        this.I = 1;
        this.PC = this.read16(0xFFFE);
        this.cycles += 7;
    }

    // Sinaliza IRQ pendente (usado pelo APU Frame Counter e DMC)
    requestIRQ() {
        this.irqPending = true;
    }

    // ─── Loop principal: executa 1 instrução ──────────────────────────────────

    step() {
        if (this.stallCycles > 0) {
            this.stallCycles--;
            this.cycles++;
            return 1;
        }

        // BUG FIX: gravar 'start' ANTES de processar interrupções,
        // para que os 7 ciclos do NMI/IRQ sejam contabilizados e
        // a PPU avance corretamente em sincronia com a CPU.
        const start = this.cycles;

        if (this.nmiPending) {
            this.nmiPending = false;
            this.triggerNMI();
        }

        if (this.irqPending) {
            this.irqPending = false;
            this.triggerIRQ();
        }

        const opcode = this.mem.read(this.PC);
        this.PC = (this.PC + 1) & 0xFFFF;
        this._execute(opcode);
        return this.cycles - start;
    }

    // ─── Modos de Endereçamento ────────────────────────────────────────────────

    _imm()   { const a = this.PC; this.PC = (this.PC+1)&0xFFFF; return {addr: a, cross: false}; }
    _zp()    { const a = this.mem.read(this.PC); this.PC = (this.PC+1)&0xFFFF; return {addr: a, cross: false}; }
    _zpx()   { const a = (this.mem.read(this.PC)+this.X)&0xFF; this.PC=(this.PC+1)&0xFFFF; return {addr: a, cross: false}; }
    _zpy()   { const a = (this.mem.read(this.PC)+this.Y)&0xFF; this.PC=(this.PC+1)&0xFFFF; return {addr: a, cross: false}; }
    _abs()   { const a = this.read16(this.PC); this.PC=(this.PC+2)&0xFFFF; return {addr: a, cross: false}; }
    _absx()  {
        const base = this.read16(this.PC); this.PC=(this.PC+2)&0xFFFF;
        const addr = (base+this.X)&0xFFFF;
        return {addr, cross: (base&0xFF00) !== (addr&0xFF00)};
    }
    _absy()  {
        const base = this.read16(this.PC); this.PC=(this.PC+2)&0xFFFF;
        const addr = (base+this.Y)&0xFFFF;
        return {addr, cross: (base&0xFF00) !== (addr&0xFF00)};
    }
    _ind()   { const ptr = this.read16(this.PC); this.PC=(this.PC+2)&0xFFFF; return {addr: this.read16bug(ptr), cross: false}; }
    _indx()  { const ptr = (this.mem.read(this.PC)+this.X)&0xFF; this.PC=(this.PC+1)&0xFFFF; return {addr: this.read16bug(ptr), cross: false}; }
    _indy()  {
        const ptr  = this.mem.read(this.PC); this.PC=(this.PC+1)&0xFFFF;
        const base = this.read16bug(ptr);
        const addr = (base+this.Y)&0xFFFF;
        return {addr, cross: (base&0xFF00) !== (addr&0xFF00)};
    }

    // ─── Branch ────────────────────────────────────────────────────────────────

    _branch(cond) {
        const raw = this.mem.read(this.PC);
        this.PC = (this.PC+1)&0xFFFF;
        if (cond) {
            this.cycles++;
            const oldPC = this.PC;
            const off   = raw < 0x80 ? raw : raw - 0x100;
            this.PC     = (this.PC + off) & 0xFFFF;
            if ((oldPC & 0xFF00) !== (this.PC & 0xFF00)) this.cycles++;
        }
    }

    // ─── Operações aritméticas / lógicas ──────────────────────────────────────

    _adc(val) {
        const r = this.A + val + this.C;
        this.V  = ((~(this.A ^ val) & (this.A ^ r)) >> 7) & 1;
        this.C  = r > 0xFF ? 1 : 0;
        this.A  = r & 0xFF;
        this.setZN(this.A);
    }

    _sbc(val) { this._adc(val ^ 0xFF); }

    _cmp(reg, val) {
        const r = reg - val;
        this.C = reg >= val ? 1 : 0;
        this.setZN(r & 0xFF);
    }

    _aslMem(a) { const v=this.mem.read(a); this.C=(v>>7)&1; const r=(v<<1)&0xFF; this.mem.write(a,r); this.setZN(r); }
    _lsrMem(a) { const v=this.mem.read(a); this.C=v&1;       const r=v>>1;          this.mem.write(a,r); this.setZN(r); }
    _rolMem(a) { const v=this.mem.read(a); const oc=this.C; this.C=(v>>7)&1; const r=((v<<1)|oc)&0xFF; this.mem.write(a,r); this.setZN(r); }
    _rorMem(a) { const v=this.mem.read(a); const oc=this.C; this.C=v&1;      const r=((v>>1)|(oc<<7))&0xFF; this.mem.write(a,r); this.setZN(r); }

    // ─── Tabela de Execução (todos os opcodes oficiais + NOPs ilegais comuns) ──

    _execute(op) {
        /* eslint-disable no-fallthrough */
        let a, r, v, oc, {addr, cross} = {addr:0, cross:false};
        switch (op) {

        // ══ LDA ══
        case 0xA9: ({addr}=this._imm());  this.A=this.mem.read(addr); this.setZN(this.A); this.cycles+=2; break;
        case 0xA5: ({addr}=this._zp());   this.A=this.mem.read(addr); this.setZN(this.A); this.cycles+=3; break;
        case 0xB5: ({addr}=this._zpx());  this.A=this.mem.read(addr); this.setZN(this.A); this.cycles+=4; break;
        case 0xAD: ({addr}=this._abs());  this.A=this.mem.read(addr); this.setZN(this.A); this.cycles+=4; break;
        case 0xBD: ({addr,cross}=this._absx()); this.A=this.mem.read(addr); this.setZN(this.A); this.cycles+=4+(cross?1:0); break;
        case 0xB9: ({addr,cross}=this._absy()); this.A=this.mem.read(addr); this.setZN(this.A); this.cycles+=4+(cross?1:0); break;
        case 0xA1: ({addr}=this._indx()); this.A=this.mem.read(addr); this.setZN(this.A); this.cycles+=6; break;
        case 0xB1: ({addr,cross}=this._indy()); this.A=this.mem.read(addr); this.setZN(this.A); this.cycles+=5+(cross?1:0); break;

        // ══ LDX ══
        case 0xA2: ({addr}=this._imm());  this.X=this.mem.read(addr); this.setZN(this.X); this.cycles+=2; break;
        case 0xA6: ({addr}=this._zp());   this.X=this.mem.read(addr); this.setZN(this.X); this.cycles+=3; break;
        case 0xB6: ({addr}=this._zpy());  this.X=this.mem.read(addr); this.setZN(this.X); this.cycles+=4; break;
        case 0xAE: ({addr}=this._abs());  this.X=this.mem.read(addr); this.setZN(this.X); this.cycles+=4; break;
        case 0xBE: ({addr,cross}=this._absy()); this.X=this.mem.read(addr); this.setZN(this.X); this.cycles+=4+(cross?1:0); break;

        // ══ LDY ══
        case 0xA0: ({addr}=this._imm());  this.Y=this.mem.read(addr); this.setZN(this.Y); this.cycles+=2; break;
        case 0xA4: ({addr}=this._zp());   this.Y=this.mem.read(addr); this.setZN(this.Y); this.cycles+=3; break;
        case 0xB4: ({addr}=this._zpx());  this.Y=this.mem.read(addr); this.setZN(this.Y); this.cycles+=4; break;
        case 0xAC: ({addr}=this._abs());  this.Y=this.mem.read(addr); this.setZN(this.Y); this.cycles+=4; break;
        case 0xBC: ({addr,cross}=this._absx()); this.Y=this.mem.read(addr); this.setZN(this.Y); this.cycles+=4+(cross?1:0); break;

        // ══ STA ══
        case 0x85: ({addr}=this._zp());   this.mem.write(addr,this.A); this.cycles+=3; break;
        case 0x95: ({addr}=this._zpx());  this.mem.write(addr,this.A); this.cycles+=4; break;
        case 0x8D: ({addr}=this._abs());  this.mem.write(addr,this.A); this.cycles+=4; break;
        case 0x9D: ({addr}=this._absx()); this.mem.write(addr,this.A); this.cycles+=5; break;
        case 0x99: ({addr}=this._absy()); this.mem.write(addr,this.A); this.cycles+=5; break;
        case 0x81: ({addr}=this._indx()); this.mem.write(addr,this.A); this.cycles+=6; break;
        case 0x91: ({addr}=this._indy()); this.mem.write(addr,this.A); this.cycles+=6; break;

        // ══ STX ══
        case 0x86: ({addr}=this._zp());  this.mem.write(addr,this.X); this.cycles+=3; break;
        case 0x96: ({addr}=this._zpy()); this.mem.write(addr,this.X); this.cycles+=4; break;
        case 0x8E: ({addr}=this._abs()); this.mem.write(addr,this.X); this.cycles+=4; break;

        // ══ STY ══
        case 0x84: ({addr}=this._zp());  this.mem.write(addr,this.Y); this.cycles+=3; break;
        case 0x94: ({addr}=this._zpx()); this.mem.write(addr,this.Y); this.cycles+=4; break;
        case 0x8C: ({addr}=this._abs()); this.mem.write(addr,this.Y); this.cycles+=4; break;

        // ══ Transfer ══
        case 0xAA: this.X=this.A; this.setZN(this.X); this.cycles+=2; break; // TAX
        case 0xA8: this.Y=this.A; this.setZN(this.Y); this.cycles+=2; break; // TAY
        case 0x8A: this.A=this.X; this.setZN(this.A); this.cycles+=2; break; // TXA
        case 0x98: this.A=this.Y; this.setZN(this.A); this.cycles+=2; break; // TYA
        case 0xBA: this.X=this.SP; this.setZN(this.X); this.cycles+=2; break; // TSX
        case 0x9A: this.SP=this.X; this.cycles+=2; break;                     // TXS

        // ══ Stack ══
        case 0x48: this.push(this.A); this.cycles+=3; break;                         // PHA
        case 0x08: this.push(this.getP()|0x30); this.cycles+=3; break;               // PHP (B=1)
        case 0x68: this.A=this.pop(); this.setZN(this.A); this.cycles+=4; break;     // PLA
        case 0x28: this.setP(this.pop()); this.cycles+=4; break;                     // PLP

        // ══ ADC ══
        case 0x69: ({addr}=this._imm());  this._adc(this.mem.read(addr)); this.cycles+=2; break;
        case 0x65: ({addr}=this._zp());   this._adc(this.mem.read(addr)); this.cycles+=3; break;
        case 0x75: ({addr}=this._zpx());  this._adc(this.mem.read(addr)); this.cycles+=4; break;
        case 0x6D: ({addr}=this._abs());  this._adc(this.mem.read(addr)); this.cycles+=4; break;
        case 0x7D: ({addr,cross}=this._absx()); this._adc(this.mem.read(addr)); this.cycles+=4+(cross?1:0); break;
        case 0x79: ({addr,cross}=this._absy()); this._adc(this.mem.read(addr)); this.cycles+=4+(cross?1:0); break;
        case 0x61: ({addr}=this._indx()); this._adc(this.mem.read(addr)); this.cycles+=6; break;
        case 0x71: ({addr,cross}=this._indy()); this._adc(this.mem.read(addr)); this.cycles+=5+(cross?1:0); break;

        // ══ SBC ══
        case 0xE9: ({addr}=this._imm());  this._sbc(this.mem.read(addr)); this.cycles+=2; break;
        case 0xEB: ({addr}=this._imm());  this._sbc(this.mem.read(addr)); this.cycles+=2; break; // ilegal
        case 0xE5: ({addr}=this._zp());   this._sbc(this.mem.read(addr)); this.cycles+=3; break;
        case 0xF5: ({addr}=this._zpx());  this._sbc(this.mem.read(addr)); this.cycles+=4; break;
        case 0xED: ({addr}=this._abs());  this._sbc(this.mem.read(addr)); this.cycles+=4; break;
        case 0xFD: ({addr,cross}=this._absx()); this._sbc(this.mem.read(addr)); this.cycles+=4+(cross?1:0); break;
        case 0xF9: ({addr,cross}=this._absy()); this._sbc(this.mem.read(addr)); this.cycles+=4+(cross?1:0); break;
        case 0xE1: ({addr}=this._indx()); this._sbc(this.mem.read(addr)); this.cycles+=6; break;
        case 0xF1: ({addr,cross}=this._indy()); this._sbc(this.mem.read(addr)); this.cycles+=5+(cross?1:0); break;

        // ══ INC ══
        case 0xE6: ({addr}=this._zp());   v=(this.mem.read(addr)+1)&0xFF; this.mem.write(addr,v); this.setZN(v); this.cycles+=5; break;
        case 0xF6: ({addr}=this._zpx());  v=(this.mem.read(addr)+1)&0xFF; this.mem.write(addr,v); this.setZN(v); this.cycles+=6; break;
        case 0xEE: ({addr}=this._abs());  v=(this.mem.read(addr)+1)&0xFF; this.mem.write(addr,v); this.setZN(v); this.cycles+=6; break;
        case 0xFE: ({addr}=this._absx()); v=(this.mem.read(addr)+1)&0xFF; this.mem.write(addr,v); this.setZN(v); this.cycles+=7; break;

        // ══ INX / INY ══
        case 0xE8: this.X=(this.X+1)&0xFF; this.setZN(this.X); this.cycles+=2; break;
        case 0xC8: this.Y=(this.Y+1)&0xFF; this.setZN(this.Y); this.cycles+=2; break;

        // ══ DEC ══
        case 0xC6: ({addr}=this._zp());   v=(this.mem.read(addr)-1)&0xFF; this.mem.write(addr,v); this.setZN(v); this.cycles+=5; break;
        case 0xD6: ({addr}=this._zpx());  v=(this.mem.read(addr)-1)&0xFF; this.mem.write(addr,v); this.setZN(v); this.cycles+=6; break;
        case 0xCE: ({addr}=this._abs());  v=(this.mem.read(addr)-1)&0xFF; this.mem.write(addr,v); this.setZN(v); this.cycles+=6; break;
        case 0xDE: ({addr}=this._absx()); v=(this.mem.read(addr)-1)&0xFF; this.mem.write(addr,v); this.setZN(v); this.cycles+=7; break;

        // ══ DEX / DEY ══
        case 0xCA: this.X=(this.X-1)&0xFF; this.setZN(this.X); this.cycles+=2; break;
        case 0x88: this.Y=(this.Y-1)&0xFF; this.setZN(this.Y); this.cycles+=2; break;

        // ══ AND ══
        case 0x29: ({addr}=this._imm());  this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=2; break;
        case 0x25: ({addr}=this._zp());   this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=3; break;
        case 0x35: ({addr}=this._zpx());  this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=4; break;
        case 0x2D: ({addr}=this._abs());  this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=4; break;
        case 0x3D: ({addr,cross}=this._absx()); this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=4+(cross?1:0); break;
        case 0x39: ({addr,cross}=this._absy()); this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=4+(cross?1:0); break;
        case 0x21: ({addr}=this._indx()); this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=6; break;
        case 0x31: ({addr,cross}=this._indy()); this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=5+(cross?1:0); break;

        // ══ ORA ══
        case 0x09: ({addr}=this._imm());  this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=2; break;
        case 0x05: ({addr}=this._zp());   this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=3; break;
        case 0x15: ({addr}=this._zpx());  this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=4; break;
        case 0x0D: ({addr}=this._abs());  this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=4; break;
        case 0x1D: ({addr,cross}=this._absx()); this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=4+(cross?1:0); break;
        case 0x19: ({addr,cross}=this._absy()); this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=4+(cross?1:0); break;
        case 0x01: ({addr}=this._indx()); this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=6; break;
        case 0x11: ({addr,cross}=this._indy()); this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=5+(cross?1:0); break;

        // ══ EOR ══
        case 0x49: ({addr}=this._imm());  this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=2; break;
        case 0x45: ({addr}=this._zp());   this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=3; break;
        case 0x55: ({addr}=this._zpx());  this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=4; break;
        case 0x4D: ({addr}=this._abs());  this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=4; break;
        case 0x5D: ({addr,cross}=this._absx()); this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=4+(cross?1:0); break;
        case 0x59: ({addr,cross}=this._absy()); this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=4+(cross?1:0); break;
        case 0x41: ({addr}=this._indx()); this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=6; break;
        case 0x51: ({addr,cross}=this._indy()); this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=5+(cross?1:0); break;

        // ══ BIT ══
        case 0x24: ({addr}=this._zp());  v=this.mem.read(addr); this.Z=((this.A&v)===0)?1:0; this.V=(v>>6)&1; this.N=(v>>7)&1; this.cycles+=3; break;
        case 0x2C: ({addr}=this._abs()); v=this.mem.read(addr); this.Z=((this.A&v)===0)?1:0; this.V=(v>>6)&1; this.N=(v>>7)&1; this.cycles+=4; break;

        // ══ CMP ══
        case 0xC9: ({addr}=this._imm());  this._cmp(this.A,this.mem.read(addr)); this.cycles+=2; break;
        case 0xC5: ({addr}=this._zp());   this._cmp(this.A,this.mem.read(addr)); this.cycles+=3; break;
        case 0xD5: ({addr}=this._zpx());  this._cmp(this.A,this.mem.read(addr)); this.cycles+=4; break;
        case 0xCD: ({addr}=this._abs());  this._cmp(this.A,this.mem.read(addr)); this.cycles+=4; break;
        case 0xDD: ({addr,cross}=this._absx()); this._cmp(this.A,this.mem.read(addr)); this.cycles+=4+(cross?1:0); break;
        case 0xD9: ({addr,cross}=this._absy()); this._cmp(this.A,this.mem.read(addr)); this.cycles+=4+(cross?1:0); break;
        case 0xC1: ({addr}=this._indx()); this._cmp(this.A,this.mem.read(addr)); this.cycles+=6; break;
        case 0xD1: ({addr,cross}=this._indy()); this._cmp(this.A,this.mem.read(addr)); this.cycles+=5+(cross?1:0); break;

        // ══ CPX ══
        case 0xE0: ({addr}=this._imm());  this._cmp(this.X,this.mem.read(addr)); this.cycles+=2; break;
        case 0xE4: ({addr}=this._zp());   this._cmp(this.X,this.mem.read(addr)); this.cycles+=3; break;
        case 0xEC: ({addr}=this._abs());  this._cmp(this.X,this.mem.read(addr)); this.cycles+=4; break;

        // ══ CPY ══
        case 0xC0: ({addr}=this._imm());  this._cmp(this.Y,this.mem.read(addr)); this.cycles+=2; break;
        case 0xC4: ({addr}=this._zp());   this._cmp(this.Y,this.mem.read(addr)); this.cycles+=3; break;
        case 0xCC: ({addr}=this._abs());  this._cmp(this.Y,this.mem.read(addr)); this.cycles+=4; break;

        // ══ ASL ══
        case 0x0A: this.C=(this.A>>7)&1; this.A=(this.A<<1)&0xFF; this.setZN(this.A); this.cycles+=2; break; // acc
        case 0x06: ({addr}=this._zp());   this._aslMem(addr); this.cycles+=5; break;
        case 0x16: ({addr}=this._zpx());  this._aslMem(addr); this.cycles+=6; break;
        case 0x0E: ({addr}=this._abs());  this._aslMem(addr); this.cycles+=6; break;
        case 0x1E: ({addr}=this._absx()); this._aslMem(addr); this.cycles+=7; break;

        // ══ LSR ══
        case 0x4A: this.C=this.A&1; this.A=this.A>>1; this.setZN(this.A); this.cycles+=2; break; // acc
        case 0x46: ({addr}=this._zp());   this._lsrMem(addr); this.cycles+=5; break;
        case 0x56: ({addr}=this._zpx());  this._lsrMem(addr); this.cycles+=6; break;
        case 0x4E: ({addr}=this._abs());  this._lsrMem(addr); this.cycles+=6; break;
        case 0x5E: ({addr}=this._absx()); this._lsrMem(addr); this.cycles+=7; break;

        // ══ ROL ══
        case 0x2A: oc=this.C; this.C=(this.A>>7)&1; this.A=((this.A<<1)|oc)&0xFF; this.setZN(this.A); this.cycles+=2; break; // acc
        case 0x26: ({addr}=this._zp());   this._rolMem(addr); this.cycles+=5; break;
        case 0x36: ({addr}=this._zpx());  this._rolMem(addr); this.cycles+=6; break;
        case 0x2E: ({addr}=this._abs());  this._rolMem(addr); this.cycles+=6; break;
        case 0x3E: ({addr}=this._absx()); this._rolMem(addr); this.cycles+=7; break;

        // ══ ROR ══
        case 0x6A: oc=this.C; this.C=this.A&1; this.A=((this.A>>1)|(oc<<7))&0xFF; this.setZN(this.A); this.cycles+=2; break; // acc
        case 0x66: ({addr}=this._zp());   this._rorMem(addr); this.cycles+=5; break;
        case 0x76: ({addr}=this._zpx());  this._rorMem(addr); this.cycles+=6; break;
        case 0x6E: ({addr}=this._abs());  this._rorMem(addr); this.cycles+=6; break;
        case 0x7E: ({addr}=this._absx()); this._rorMem(addr); this.cycles+=7; break;

        // ══ JMP ══
        case 0x4C: this.PC=this.read16(this.PC); this.cycles+=3; break;                    // abs
        case 0x6C: ({addr}=this._ind()); this.PC=addr; this.cycles+=5; break;              // ind

        // ══ JSR / RTS / RTI ══
        case 0x20: this.push16(this.PC+1); this.PC=this.read16(this.PC); this.cycles+=6; break;
        case 0x60: this.PC=(this.pop16()+1)&0xFFFF; this.cycles+=6; break;
        case 0x40: this.setP(this.pop()); this.PC=this.pop16(); this.cycles+=6; break;

        // ══ Branch ══
        case 0x90: this._branch(this.C===0); this.cycles+=2; break; // BCC
        case 0xB0: this._branch(this.C===1); this.cycles+=2; break; // BCS
        case 0xF0: this._branch(this.Z===1); this.cycles+=2; break; // BEQ
        case 0x30: this._branch(this.N===1); this.cycles+=2; break; // BMI
        case 0xD0: this._branch(this.Z===0); this.cycles+=2; break; // BNE
        case 0x10: this._branch(this.N===0); this.cycles+=2; break; // BPL
        case 0x50: this._branch(this.V===0); this.cycles+=2; break; // BVC
        case 0x70: this._branch(this.V===1); this.cycles+=2; break; // BVS

        // ══ Flags ══
        case 0x18: this.C=0; this.cycles+=2; break; // CLC
        case 0xD8: this.D=0; this.cycles+=2; break; // CLD
        case 0x58: this.I=0; this.cycles+=2; break; // CLI
        case 0xB8: this.V=0; this.cycles+=2; break; // CLV
        case 0x38: this.C=1; this.cycles+=2; break; // SEC
        case 0xF8: this.D=1; this.cycles+=2; break; // SED
        case 0x78: this.I=1; this.cycles+=2; break; // SEI

        // ══ NOP (oficial + ilegais comuns) ══
        case 0xEA:                                               this.cycles+=2; break;
        case 0x1A: case 0x3A: case 0x5A: case 0x7A:
        case 0xDA: case 0xFA:                                    this.cycles+=2; break;
        case 0x80: case 0x82: case 0x89: case 0xC2: case 0xE2:
            this.PC=(this.PC+1)&0xFFFF;                          this.cycles+=2; break;
        case 0x04: case 0x44: case 0x64:
            this.PC=(this.PC+1)&0xFFFF;                          this.cycles+=3; break;
        case 0x14: case 0x34: case 0x54: case 0x74:
        case 0xD4: case 0xF4:
            this.PC=(this.PC+1)&0xFFFF;                          this.cycles+=4; break;
        case 0x0C:
            this.PC=(this.PC+2)&0xFFFF;                          this.cycles+=4; break;
        case 0x1C: case 0x3C: case 0x5C: case 0x7C:
        case 0xDC: case 0xFC:
            ({cross}=this._absx());                              this.cycles+=4+(cross?1:0); break;

        // ══ BRK ══
        case 0x00:
            this.PC=(this.PC+1)&0xFFFF;
            this.push16(this.PC);
            this.push(this.getP()|0x30);
            this.I=1;
            this.PC=this.read16(0xFFFE);
            this.cycles+=7;
            break;

        // ════════════════════════════════════════════════════════════════════
        // OPCODES ILEGAIS / NÃO-DOCUMENTADOS DO 6502
        // Usados por muitos jogos NES reais (SMB3, Mega Man, Castlevania, etc.)
        // ════════════════════════════════════════════════════════════════════

        // ══ SLO — ASL + ORA (também chamado ASO) ══
        // Faz ASL na memória e depois OR com A
        case 0x07: ({addr}=this._zp());   this._aslMem(addr); this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=5; break;
        case 0x17: ({addr}=this._zpx());  this._aslMem(addr); this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=6; break;
        case 0x0F: ({addr}=this._abs());  this._aslMem(addr); this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=6; break;
        case 0x1F: ({addr}=this._absx()); this._aslMem(addr); this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=7; break;
        case 0x1B: ({addr}=this._absy()); this._aslMem(addr); this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=7; break;
        case 0x03: ({addr}=this._indx()); this._aslMem(addr); this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=8; break;
        case 0x13: ({addr}=this._indy()); this._aslMem(addr); this.A|=this.mem.read(addr); this.setZN(this.A); this.cycles+=8; break;

        // ══ RLA — ROL + AND ══
        // Faz ROL na memória e depois AND com A
        case 0x27: ({addr}=this._zp());   this._rolMem(addr); this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=5; break;
        case 0x37: ({addr}=this._zpx());  this._rolMem(addr); this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=6; break;
        case 0x2F: ({addr}=this._abs());  this._rolMem(addr); this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=6; break;
        case 0x3F: ({addr}=this._absx()); this._rolMem(addr); this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=7; break;
        case 0x3B: ({addr}=this._absy()); this._rolMem(addr); this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=7; break;
        case 0x23: ({addr}=this._indx()); this._rolMem(addr); this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=8; break;
        case 0x33: ({addr}=this._indy()); this._rolMem(addr); this.A&=this.mem.read(addr); this.setZN(this.A); this.cycles+=8; break;

        // ══ SRE — LSR + EOR (também chamado LSE) ══
        // Faz LSR na memória e depois EOR com A
        case 0x47: ({addr}=this._zp());   this._lsrMem(addr); this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=5; break;
        case 0x57: ({addr}=this._zpx());  this._lsrMem(addr); this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=6; break;
        case 0x4F: ({addr}=this._abs());  this._lsrMem(addr); this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=6; break;
        case 0x5F: ({addr}=this._absx()); this._lsrMem(addr); this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=7; break;
        case 0x5B: ({addr}=this._absy()); this._lsrMem(addr); this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=7; break;
        case 0x43: ({addr}=this._indx()); this._lsrMem(addr); this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=8; break;
        case 0x53: ({addr}=this._indy()); this._lsrMem(addr); this.A^=this.mem.read(addr); this.setZN(this.A); this.cycles+=8; break;

        // ══ RRA — ROR + ADC ══
        // Faz ROR na memória e depois ADC com A
        case 0x67: ({addr}=this._zp());   this._rorMem(addr); this._adc(this.mem.read(addr)); this.cycles+=5; break;
        case 0x77: ({addr}=this._zpx());  this._rorMem(addr); this._adc(this.mem.read(addr)); this.cycles+=6; break;
        case 0x6F: ({addr}=this._abs());  this._rorMem(addr); this._adc(this.mem.read(addr)); this.cycles+=6; break;
        case 0x7F: ({addr}=this._absx()); this._rorMem(addr); this._adc(this.mem.read(addr)); this.cycles+=7; break;
        case 0x7B: ({addr}=this._absy()); this._rorMem(addr); this._adc(this.mem.read(addr)); this.cycles+=7; break;
        case 0x63: ({addr}=this._indx()); this._rorMem(addr); this._adc(this.mem.read(addr)); this.cycles+=8; break;
        case 0x73: ({addr}=this._indy()); this._rorMem(addr); this._adc(this.mem.read(addr)); this.cycles+=8; break;

        // ══ SAX — Store A & X ══
        // Grava (A AND X) na memória, sem alterar flags
        case 0x87: ({addr}=this._zp());   this.mem.write(addr,this.A&this.X); this.cycles+=3; break;
        case 0x97: ({addr}=this._zpy());  this.mem.write(addr,this.A&this.X); this.cycles+=4; break;
        case 0x8F: ({addr}=this._abs());  this.mem.write(addr,this.A&this.X); this.cycles+=4; break;
        case 0x83: ({addr}=this._indx()); this.mem.write(addr,this.A&this.X); this.cycles+=6; break;

        // ══ LAX — LDA + LDX ══
        // Carrega valor em A e X ao mesmo tempo
        case 0xA7: ({addr}=this._zp());   this.A=this.X=this.mem.read(addr); this.setZN(this.A); this.cycles+=3; break;
        case 0xB7: ({addr}=this._zpy());  this.A=this.X=this.mem.read(addr); this.setZN(this.A); this.cycles+=4; break;
        case 0xAF: ({addr}=this._abs());  this.A=this.X=this.mem.read(addr); this.setZN(this.A); this.cycles+=4; break;
        case 0xBF: ({addr,cross}=this._absy()); this.A=this.X=this.mem.read(addr); this.setZN(this.A); this.cycles+=4+(cross?1:0); break;
        case 0xA3: ({addr}=this._indx()); this.A=this.X=this.mem.read(addr); this.setZN(this.A); this.cycles+=6; break;
        case 0xB3: ({addr,cross}=this._indy()); this.A=this.X=this.mem.read(addr); this.setZN(this.A); this.cycles+=5+(cross?1:0); break;

        // ══ DCP — DEC + CMP ══
        // Decrementa memória e compara com A
        case 0xC7: ({addr}=this._zp());   v=(this.mem.read(addr)-1)&0xFF; this.mem.write(addr,v); this._cmp(this.A,v); this.cycles+=5; break;
        case 0xD7: ({addr}=this._zpx());  v=(this.mem.read(addr)-1)&0xFF; this.mem.write(addr,v); this._cmp(this.A,v); this.cycles+=6; break;
        case 0xCF: ({addr}=this._abs());  v=(this.mem.read(addr)-1)&0xFF; this.mem.write(addr,v); this._cmp(this.A,v); this.cycles+=6; break;
        case 0xDF: ({addr}=this._absx()); v=(this.mem.read(addr)-1)&0xFF; this.mem.write(addr,v); this._cmp(this.A,v); this.cycles+=7; break;
        case 0xDB: ({addr}=this._absy()); v=(this.mem.read(addr)-1)&0xFF; this.mem.write(addr,v); this._cmp(this.A,v); this.cycles+=7; break;
        case 0xC3: ({addr}=this._indx()); v=(this.mem.read(addr)-1)&0xFF; this.mem.write(addr,v); this._cmp(this.A,v); this.cycles+=8; break;
        case 0xD3: ({addr}=this._indy()); v=(this.mem.read(addr)-1)&0xFF; this.mem.write(addr,v); this._cmp(this.A,v); this.cycles+=8; break;

        // ══ ISC / ISB — INC + SBC ══
        // Incrementa memória e subtrai de A (com carry)
        case 0xE7: ({addr}=this._zp());   v=(this.mem.read(addr)+1)&0xFF; this.mem.write(addr,v); this._sbc(v); this.cycles+=5; break;
        case 0xF7: ({addr}=this._zpx());  v=(this.mem.read(addr)+1)&0xFF; this.mem.write(addr,v); this._sbc(v); this.cycles+=6; break;
        case 0xEF: ({addr}=this._abs());  v=(this.mem.read(addr)+1)&0xFF; this.mem.write(addr,v); this._sbc(v); this.cycles+=6; break;
        case 0xFF: ({addr}=this._absx()); v=(this.mem.read(addr)+1)&0xFF; this.mem.write(addr,v); this._sbc(v); this.cycles+=7; break;
        case 0xFB: ({addr}=this._absy()); v=(this.mem.read(addr)+1)&0xFF; this.mem.write(addr,v); this._sbc(v); this.cycles+=7; break;
        case 0xE3: ({addr}=this._indx()); v=(this.mem.read(addr)+1)&0xFF; this.mem.write(addr,v); this._sbc(v); this.cycles+=8; break;
        case 0xF3: ({addr}=this._indy()); v=(this.mem.read(addr)+1)&0xFF; this.mem.write(addr,v); this._sbc(v); this.cycles+=8; break;

        // ══ ANC — AND + set Carry from bit 7 ══
        case 0x0B: case 0x2B:
            ({addr}=this._imm()); this.A&=this.mem.read(addr); this.setZN(this.A); this.C=this.N; this.cycles+=2; break;

        // ══ ALR / ASR — AND + LSR acumulador ══
        case 0x4B:
            ({addr}=this._imm()); this.A&=this.mem.read(addr); this.C=this.A&1; this.A>>=1; this.setZN(this.A); this.cycles+=2; break;

        // ══ ARR — AND + ROR acumulador (com flags especiais) ══
        case 0x6B: {
            ({addr}=this._imm());
            const andVal = this.A & this.mem.read(addr);
            this.A = ((andVal >> 1) | (this.C << 7)) & 0xFF;
            this.setZN(this.A);
            this.C = (this.A >> 6) & 1;
            this.V = ((this.A >> 6) ^ (this.A >> 5)) & 1;
            this.cycles+=2; break;
        }

        // ══ AXS / SBX — (A AND X) - imm → X ══
        case 0xCB: {
            ({addr}=this._imm());
            const axs = (this.A & this.X) - this.mem.read(addr);
            this.C = axs >= 0 ? 1 : 0;
            this.X = axs & 0xFF;
            this.setZN(this.X);
            this.cycles+=2; break;
        }

        // ══ LAS / LAR — LDA + LDX + TSX (memória AND SP) ══
        case 0xBB: {
            ({addr,cross}=this._absy());
            v = this.mem.read(addr) & this.SP;
            this.A = this.X = this.SP = v;
            this.setZN(this.A);
            this.cycles+=4+(cross?1:0); break;
        }

        // ══ XAA / ANE — instável, aproximação ══
        case 0x8B:
            ({addr}=this._imm()); this.A=(this.A|0xEE)&this.X&this.mem.read(addr); this.setZN(this.A); this.cycles+=2; break;

        // ══ SHY / A11 — Y & (high byte do addr + 1) → mem ══
        case 0x9C: {
            ({addr}=this._absx());
            const hi9c = ((addr >> 8) + 1) & 0xFF;
            this.mem.write(addr, this.Y & hi9c);
            this.cycles+=5; break;
        }

        // ══ SHX — X & (high byte + 1) ══
        case 0x9E: {
            ({addr}=this._absy());
            const hi9e = ((addr >> 8) + 1) & 0xFF;
            this.mem.write(addr, this.X & hi9e);
            this.cycles+=5; break;
        }

        // ══ Opcode desconhecido — skip seguro ══
        default:
            // Suprime warnings repetitivos após o primeiro
            if (!this._unknownOps) this._unknownOps = {};
            if (!this._unknownOps[op]) {
                this._unknownOps[op] = true;
                console.warn(`[CPU] Opcode ilegal não implementado: 0x${op.toString(16).toUpperCase().padStart(2,'0')} @ PC=0x${((this.PC-1)&0xFFFF).toString(16).toUpperCase().padStart(4,'0')}`);
            }
            this.cycles+=2;
            break;
        }
    }
}
