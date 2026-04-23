/**
 * NES Emulator - Input Handler
 *
 * Suporte a:
 *   1. Teclado (mapeamento padrão + configurável)
 *   2. Gamepad API (XInput / Xbox Controller no macOS via USB ou Bluetooth)
 *
 * Botões NES (byte de estado):
 *   Bit 0: A      Bit 4: Up
 *   Bit 1: B      Bit 5: Down
 *   Bit 2: Select Bit 6: Left
 *   Bit 3: Start  Bit 7: Right
 */

class Input {
    constructor() {
        // Estado dos botões de cada jogador (bitmask)
        this.state = [0, 0]; // [P1, P2]

        // Mapeamento teclado → botão (jogador 1)
        this.keyMap = {
            // D-Pad
            'ArrowUp':    { player: 0, bit: 4 },
            'ArrowDown':  { player: 0, bit: 5 },
            'ArrowLeft':  { player: 0, bit: 6 },
            'ArrowRight': { player: 0, bit: 7 },
            // Botões
            'KeyZ':       { player: 0, bit: 0 }, // A
            'KeyX':       { player: 0, bit: 1 }, // B
            'ShiftRight': { player: 0, bit: 2 }, // Select
            'Enter':      { player: 0, bit: 3 }, // Start
            // Alternativas WASD (P1)
            'KeyW':       { player: 0, bit: 4 },
            'KeyS':       { player: 0, bit: 5 },
            'KeyA':       { player: 0, bit: 6 },
            'KeyD':       { player: 0, bit: 7 },
            // Jogador 2 (numpad)
            'Numpad8':    { player: 1, bit: 4 },
            'Numpad2':    { player: 1, bit: 5 },
            'Numpad4':    { player: 1, bit: 6 },
            'Numpad6':    { player: 1, bit: 7 },
            'Numpad1':    { player: 1, bit: 0 },
            'Numpad3':    { player: 1, bit: 1 },
            'Numpad7':    { player: 1, bit: 2 },
            'Numpad9':    { player: 1, bit: 3 },
        };

        // Mapeamento gamepad (XInput / Standard Gamepad Layout)
        // índice do botão na Gamepad API → bit NES
        // https://w3c.github.io/gamepad/#remapping
        this.padMap = [
            { bit: 0 },  // 0: A (Xbox A)
            { bit: 1 },  // 1: B (Xbox B)  → NES B
            { bit: 0 },  // 2: X → NES A (turbo)
            { bit: 1 },  // 3: Y → NES B (turbo)
            { bit: 2 },  // 4: LB → Select
            { bit: 3 },  // 5: RB → Start
            null,        // 6: LT
            null,        // 7: RT
            { bit: 2 },  // 8: Back/Select → Select
            { bit: 3 },  // 9: Start → Start
            null,        // 10: L3
            null,        // 11: R3
            { bit: 4 },  // 12: D-Pad Up
            { bit: 5 },  // 13: D-Pad Down
            { bit: 6 },  // 14: D-Pad Left
            { bit: 7 },  // 15: D-Pad Right
        ];

        this._setupKeyboard();

        // Log de gamepads conectados
        window.addEventListener('gamepadconnected', (e) => {
            console.log(`[Input] Gamepad conectado: "${e.gamepad.id}" (índice ${e.gamepad.index})`);
            this._notifyUI(`Controle conectado: ${e.gamepad.id}`);
        });
        window.addEventListener('gamepaddisconnected', (e) => {
            console.log(`[Input] Gamepad desconectado: índice ${e.gamepad.index}`);
        });
    }

    // ─── Teclado ──────────────────────────────────────────────────────────────

    _setupKeyboard() {
        window.addEventListener('keydown', (e) => {
            const map = this.keyMap[e.code];
            if (map) {
                e.preventDefault();
                this.state[map.player] |= (1 << map.bit);
            }
        });
        window.addEventListener('keyup', (e) => {
            const map = this.keyMap[e.code];
            if (map) {
                e.preventDefault();
                this.state[map.player] &= ~(1 << map.bit);
            }
        });
    }

    // ─── Gamepad (XInput) ─────────────────────────────────────────────────────

    _pollGamepad() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

        for (let gi = 0; gi < Math.min(gamepads.length, 2); gi++) {
            const gp = gamepads[gi];
            if (!gp) continue;

            let state = 0;

            // Botões digitais
            for (let bi = 0; bi < gp.buttons.length && bi < this.padMap.length; bi++) {
                const map = this.padMap[bi];
                if (!map) continue;
                if (gp.buttons[bi].pressed) state |= (1 << map.bit);
            }

            // Analógico esquerdo como D-Pad
            if (gp.axes.length >= 2) {
                const ax = gp.axes[0];
                const ay = gp.axes[1];
                const deadzone = 0.5;
                if (ay < -deadzone) state |= (1 << 4); // Up
                if (ay >  deadzone) state |= (1 << 5); // Down
                if (ax < -deadzone) state |= (1 << 6); // Left
                if (ax >  deadzone) state |= (1 << 7); // Right
            }

            this.state[gi] = state;
        }
    }

    // ─── API pública ──────────────────────────────────────────────────────────

    /**
     * Retorna o estado dos botões como bitmask para o jogador (1 ou 2).
     * Deve ser chamado a cada frame.
     */
    getButtons(player) {
        this._pollGamepad();
        return this.state[player - 1] & 0xFF;
    }

    // Opcional: notificar UI
    _notifyUI(msg) {
        const el = document.getElementById('controller-status');
        if (el) el.textContent = msg;
    }

    // Retorna string descritiva do mapeamento para exibir na UI
    getKeyboardMap() {
        return [
            { label: '↑ ↓ ← →  ou  W S A D', action: 'D-Pad' },
            { label: 'Z',                      action: 'Botão A' },
            { label: 'X',                      action: 'Botão B' },
            { label: 'Enter',                  action: 'Start' },
            { label: 'Shift Direito',          action: 'Select' },
        ];
    }
}
