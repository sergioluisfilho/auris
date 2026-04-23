# 🐚 Auris — NES Emulator

> *Auris* is Latin for "ear" — the same root as *audio*. Named after the ear-shaped shell,  
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

| Key | NES Button |
|-----|-----------|
| `↑ ↓ ← →` or `W A S D` | D-Pad |
| `Z` | A |
| `X` | B |
| `Enter` | Start |
| `Shift` (right) | Select |
| `Esc` | Pause |
| `F5` | Reset |

### Xbox / XInput Controller

Connect via USB or Bluetooth — detected automatically.

| Button | NES Button |
|--------|-----------|
| A | A |
| B | B |
| D-Pad | D-Pad |
| Left stick | D-Pad |
| Start | Start |
| Back / Select | Select |

---

## Supported Mappers

| Mapper | Name | Notable Games |
|--------|------|---------------|
| 0 — NROM | No mapper | Donkey Kong, Pac-Man, Super Mario Bros. |
| 1 — MMC1 | Nintendo MMC1 | Mega Man 2, Metroid, The Legend of Zelda |
| 2 — UxROM | Konami/etc | Castlevania, Contra, DuckTales |
| 3 — CNROM | Coleco/etc | Arkanoid, Gradius |
| 4 — MMC3 | Nintendo MMC3 | **Super Mario Bros. 3**, Mega Man 3-6, Kirby |

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

- Emulators are explicitly legal. This was established by U.S. federal courts in *Sony Computer Entertainment v. Connectix Corp.* (9th Cir. 2000) and the *Bleem!* case. The courts ruled that creating a compatible emulator via clean-room implementation does not infringe copyright.
- The NES hardware was released in 1983. All relevant hardware patents have long since expired (patents last 20 years in most jurisdictions).
- Auris contains **zero lines of Nintendo's code**. It was written entirely from scratch using publicly available NES hardware documentation (nesdev.org).
- The Web Gamepad API, Canvas API, and Web Audio API are open web standards.

### ROMs

**Auris does not include any ROMs. You must supply your own.**

- Distributing commercial NES ROMs without authorization from the copyright holder is illegal in most countries, regardless of whether you own the original cartridge.
- **For testing and development**, use freely available homebrew ROMs — games written by independent developers and released with open licenses. A good starting point: [homebrew ROMs at itch.io](https://itch.io/games/tag-nes) or [nesdev.org homebrew](https://www.nesdev.org/wiki/Homebrew_games).
- Nintendo retains copyright on their original game titles, characters, and music. The emulator does not claim any rights over them.

### Summary

| What | Legal? |
|------|--------|
| Publishing Auris on GitHub | ✅ Yes |
| Distributing Auris | ✅ Yes |
| Using Auris with ROMs you created | ✅ Yes |
| Using Auris with commercial ROMs | ⚠️ Depends on your local laws and ROM source |
| Including ROMs in this repo | ❌ No |

---

## Roadmap

- [ ] APU — audio (Web Audio API, all 5 channels)
- [ ] Save states
- [ ] More mappers (5/MMC5, VRC6, FME-7)
- [ ] Rewind
- [ ] Touch controls (mobile)

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

*Named after the* Auris *shell — same family as the abalone, same shape as a human ear.*  
*Shell + ear = something that listens. A fitting name for a terminal tool.*
