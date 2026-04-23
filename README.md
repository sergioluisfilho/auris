# 🐚 Auris — NES Emulator

> _Auris_ is Latin for "ear" — the same root as _audio_. Named after the ear-shaped shell,  
> built by someone whose nickname is Shell. It listens to your commands.

A cycle-accurate NES emulator written in **pure JavaScript + HTML**.  
No frameworks. No build step. Open `index.html` and play.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![Language](https://img.shields.io/badge/language-JavaScript-yellow)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Full 6502 CPU** — all official opcodes + most illegal/undocumented opcodes used by real games
- **Accurate PPU** — background tiles, sprites (8×8 and 8×16), fine scroll (Loopy registers), NMI
- **MMC3 IRQ** — mid-frame CHR bank switching for split-screen effects (status bars, etc.)
- **Xbox / XInput controller** — detected automatically via Web Gamepad API
- **Keyboard fallback** — play without a controller
- **Drag & drop ROM loading** — just drop a `.nes` file onto the window
- **2× / 3× pixel scaling** — crisp pixel-perfect rendering
- **60 FPS** — synced via `requestAnimationFrame`

---

## How to Run

No installation required.

```bash
# Clone the repo
git clone https://github.com/your-username/auris.git
cd auris

# Open in browser (macOS)
open index.html

# Or serve locally (avoids any CORS issues with some browsers)
npx live-server .
# then open http://localhost:8080
```

> **macOS tip:** In Finder, right-click the `auris` folder → "New Terminal at Folder", then run `open index.html`.

---

## Controls

### Keyboard

| Key                    | NES Button |
| ---------------------- | ---------- |
| `↑ ↓ ← →` or `W A S D` | D-Pad      |
| `Z`                    | A          |
| `X`                    | B          |
| `Enter`                | Start      |
| `Shift` (right)        | Select     |
| `Esc`                  | Pause      |
| `F5`                   | Reset      |

### Xbox / XInput Controller

Connect via USB or Bluetooth — detected automatically.

| Button        | NES Button |
| ------------- | ---------- |
| A             | A          |
| B             | B          |
| D-Pad         | D-Pad      |
| Left stick    | D-Pad      |
| Start         | Start      |
| Back / Select | Select     |

---

## Supported Mappers

| Mapper    | Name          | Notable Games                                |
| --------- | ------------- | -------------------------------------------- |
| 0 — NROM  | No mapper     | Donkey Kong, Pac-Man, Super Mario Bros.      |
| 1 — MMC1  | Nintendo MMC1 | Mega Man 2, Metroid, The Legend of Zelda     |
| 2 — UxROM | Konami/etc    | Castlevania, Contra, DuckTales               |
| 3 — CNROM | Coleco/etc    | Arkanoid, Gradius                            |
| 4 — MMC3  | Nintendo MMC3 | **Super Mario Bros. 3**, Mega Man 3-6, Kirby |

Most classic NES games fall into these five mappers.  
More complex mappers (5/FME-7/VRC6) are planned for future updates.

---

## Project Structure

```
auris/
├── index.html          Main UI (canvas, controls, ROM loader)
└── src/
    ├── cpu.js          MOS 6502 CPU — all opcodes, cycle-accurate
    ├── ppu.js          Picture Processing Unit — rendering pipeline
    ├── apu.js          Audio Processing Unit — stub (silent)
    ├── memory.js       Memory bus, OAM DMA, controller latches
    ├── rom.js          iNES parser, Mappers 0–4, CHR/PRG banking
    ├── input.js        Keyboard + Web Gamepad API (XInput)
    └── nes.js          Main orchestrator, 60fps game loop
```

### Architecture Notes

- **CPU ↔ PPU sync**: 3 PPU ticks per CPU cycle (NTSC: ~1.79 MHz CPU / ~5.37 MHz PPU)
- **MMC3 IRQ**: clocked at PPU dot 260 per scanline — the standard approach used by Nestopia/FCEUX
- **Loopy scroll registers**: full implementation of the v/t/x/w internal PPU registers
- **Illegal opcodes**: SLO, RLA, SRE, RRA, SAX, LAX, DCP, ISC, ANC, ALR, ARR, AXS and more

---

## Legal

### The emulator

**Auris is 100% legal to use, distribute, and publish.**

- Emulators are explicitly legal. This was established by U.S. federal courts in _Sony Computer Entertainment v. Connectix Corp._ (9th Cir. 2000) and the _Bleem!_ case. The courts ruled that creating a compatible emulator via clean-room implementation does not infringe copyright.
- The NES hardware was released in 1983. All relevant hardware patents have long since expired (patents last 20 years in most jurisdictions).
- Auris contains **zero lines of Nintendo's code**. It was written entirely from scratch using publicly available NES hardware documentation (nesdev.org).
- The Web Gamepad API, Canvas API, and Web Audio API are open web standards.

### ROMs

**Auris does not include any ROMs. You must supply your own.**

- Distributing commercial NES ROMs without authorization from the copyright holder is illegal in most countries, regardless of whether you own the original cartridge.
- **For testing and development**, use freely available homebrew ROMs — games written by independent developers and released with open licenses. A good starting point: [homebrew ROMs at itch.io](https://itch.io/games/tag-nes) or [nesdev.org homebrew](https://www.nesdev.org/wiki/Homebrew_games).
- Nintendo retains copyright on their original game titles, characters, and music. The emulator does not claim any rights over them.

### Summary

| What                              | Legal?                                       |
| --------------------------------- | -------------------------------------------- |
| Publishing Auris on GitHub        | ✅ Yes                                       |
| Distributing Auris                | ✅ Yes                                       |
| Using Auris with ROMs you created | ✅ Yes                                       |
| Using Auris with commercial ROMs  | ⚠️ Depends on your local laws and ROM source |
| Including ROMs in this repo       | ❌ No                                        |

---

## Roadmap

### ✅ Implemented

- [x] **Full 6502 CPU** — all official and illegal opcodes used by real games
- [x] **PPU** — background, 8×8 and 8×16 sprites, fine scroll (Loopy registers), NMI
- [x] **Mapper 0 (NROM)** — Super Mario Bros., Donkey Kong, Pac-Man
- [x] **Mapper 1 (MMC1)** — Mega Man 2, Metroid, Zelda
- [x] **Mapper 2 (UxROM)** — Castlevania, Contra, DuckTales
- [x] **Mapper 3 (CNROM)** — Arkanoid, Gradius
- [x] **Mapper 4 (MMC3)** — Super Mario Bros. 3, Mega Man 3–6, Kirby
- [x] **MMC3 IRQ** — mid-frame CHR bank switching (status bar)
- [x] **OAM DMA** — sprite data transfer ($4014)
- [x] **Xbox / XInput Controller** — via Web Gamepad API, USB and Bluetooth
- [x] **Keyboard Controls** — with configurable mapping
- [x] **ROM Drag & Drop** — drop directly into the window
- [x] **2× / 3× Scaling** — pixel-perfect
- [x] **60 FPS** — loop via `requestAnimationFrame`
- [x] **Gamepad Detection** — status displayed in the UI

---

### 🔧 Pending Visual Fixes

- [ ] **Horizontal scroll glitch** — occasional artifacts when crossing nametable boundaries in some games
- [ ] **Sprite overflow** — exact flag behavior when more than 8 sprites per scanline
- [ ] **Sprite 0 hit** — timing refinement for more precise split-screen effects
- [ ] **PPU open bus** — reads from unimplemented registers return bus noise

---

### 🔊 Audio

- [ ] **APU — Pulse 1 and Pulse 2** — the two square wave channels (main melodies)
- [ ] **APU — Triangle** — triangle wave channel (bass, effects)
- [ ] **APU — Noise** — noise channel (percussion, explosions)
- [ ] **APU — DMC** — digital sample channel (voices, samples)
- [ ] **APU — Frame counter IRQ** — internal APU timing

---

### 💾 Saving

- [ ] **Battery saves (SRAM)** — save progress in battery-backed games (Zelda, Metroid) via `localStorage`
- [ ] **Save states** — full snapshot of the machine state at any time
- [ ] **Multiple save state slots** — slots 1–9 with frame preview
- [ ] **Export / import save states** — download and upload `.auris` files

---

### 📱 Mobile and PWA

- [ ] **Touch controls** — On-screen D-pad and buttons for mobile and tablet
- [ ] **Responsive layout** — adapts canvas and UI for small screens
- [ ] **PWA (Progressive Web App)** — install as a mobile app, works offline
- [ ] **Service Worker** — asset caching for offline use
- [ ] **Manifest** — icon, name, and splash screen for homescreen installation

---

### 🎮 Gameplay

- [ ] **Turbo buttons** — A and B with configurable auto-fire
- [ ] **Rewind** — go back in time (state ringbuffer)
- [ ] **Speed adjustment** — 0.5× / 1× / 2× / 4×
- [ ] **True fullscreen mode** — canvas occupies 100% without browser bars
- [ ] **Control remapping** — UI to change any button

---

### 🗂️ Mappers

- [ ] **Mapper 5 (MMC5)** — Castlevania III, Just Breed (the most complex)
- [ ] **Mapper 7 (AxROM)** — Battletoads, Marble Madness
- [ ] **Mapper 9 (MMC2)** — Mike Tyson's Punch-Out!!
- [ ] **Mapper 19 (Namco 163)** — Megami Tensei II, Battle City
- [ ] **Mapper 21/23/25 (VRC2/4)** — advanced Konami games
- [ ] **Mapper 24/26 (VRC6)** — Akumajou Densetsu, Esper Dream 2
- [ ] **Mapper 69 (FME-7/Sunsoft 5B)** — Batman Return of the Joker

---

### 🛠️ Developer

- [ ] **CPU Debugger** — step, breakpoints, register visualization
- [ ] **PPU Viewer** — real-time nametables, pattern tables, and palettes
- [ ] **Game Genie** — support for classic format cheats
- [ ] **Netlify / Vercel deploy** — host as a public webapp without installation

---

## License

```
MIT License

Copyright (c) 2026 Shell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

_Named after the_ Auris _shell — same family as the abalone, same shape as a human ear._  
_Shell + ear = something that listens. A fitting name for a terminal tool._
