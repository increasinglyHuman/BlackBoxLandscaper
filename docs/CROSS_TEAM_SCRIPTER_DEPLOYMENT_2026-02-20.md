# Cross-Team Brief: Black Box Scripter — Deployed to Production

**Date:** 2026-02-20
**From:** Scripter Team
**To:** World Team, Legacy Team, Landscaper Team
**Status:** LIVE IN PRODUCTION

---

## What Happened

Black Box Scripter is now deployed to production with two interfaces:

| Asset | URL / Path | Purpose |
|-------|-----------|---------|
| **Script Editor** | https://poqpoq.com/scripter/ | Monaco-based editor with LSL IntelliSense |
| **CLI (transpile)** | `/home/ubuntu/scripter/dist/transpiler/cli.js` | Single LSL → TypeScript conversion |
| **CLI (bundle)** | `/home/ubuntu/scripter/dist/transpiler/cli.js` | Batch transpile from OAR manifest |

---

## Sandbox Integration — CONFIRMED WORKING

The three-layer sandbox (Web Worker + SES + AST transform) is running inside World:

```
window.bbWorldsApp.scripting.loadScript('console.log("Hello from sandbox!")', 'test')
```

```
SES Removing unpermitted intrinsics
[Script:38d062a1] Hello from sandbox!
[Script:38d062a1] Script did not export a default class
```

**What this proves:**
- Worker pool spawns correctly
- SES `lockdown()` fires and removes dangerous intrinsics
- Scripts execute in the sandbox
- The "did not export a default class" message is correct — raw `console.log` isn't a `WorldScript` class

**Next test:** Load a proper WorldScript class:
```javascript
window.bbWorldsApp.scripting.loadScript(`
  import { WorldScript } from "poqpoq/types";
  export default class TestDoor extends WorldScript {
    states = {
      default: {
        async onStateEntry() { this.say(0, "Door ready!"); }
      }
    };
  }
`, 'test-door')
```

---

## For World Team

### What's Available to You

1. **ScriptHostAdapter** — The single class you instantiate. Already integrated.
   ```typescript
   import { ScriptHostAdapter } from "blackbox-scripter/integration";
   ```

2. **Protocol types** — `ScriptCommand` and `ScriptEvent` discriminated unions.
   ```typescript
   import type { ScriptCommandEnvelope, ScriptEventEnvelope } from "blackbox-scripter/protocol";
   ```

3. **Bundle pipeline** — For loading OAR bundles with scripts.
   ```typescript
   import { BundleParser, BundleTranspiler } from "blackbox-scripter/integration";
   ```

### Integration Status

| Component | Status | Notes |
|-----------|--------|-------|
| ScriptHostAdapter | Integrated | `bbWorldsApp.scripting.adapter` |
| BabylonBridge | Integrated | `bbWorldsApp.scripting.bridge` — handles commands |
| EventForwarder | Integrated | `bbWorldsApp.scripting.forwarder` — 1 observer active |
| Worker pool | Working | SES lockdown confirmed |
| Script Editor UI | Deployed | https://poqpoq.com/scripter/ (standalone for now) |

### Open Questions for World Team

- [ ] **Editor embedding:** Should the editor open in an iframe within World's UI, or stay standalone at `/scripter/`?
- [ ] **Bundle loading:** When an OAR is imported, should World call the CLI on the server or use the in-browser transpiler?
- [ ] **NEXUS persistence:** Are scripts stored per-instance in NEXUS JSONB, or in a separate table?
- [ ] **Event wiring:** Which Babylon.js observables are currently forwarded to scripts? (touch, collision, timer, day/night?)

---

## For Legacy Team

### CLI Usage

The CLI is available on the production server for pre-transpilation during OAR export.

**Single file:**
```bash
node /home/ubuntu/scripter/dist/transpiler/cli.js transpile input.lsl -o output.ts
node /home/ubuntu/scripter/dist/transpiler/cli.js transpile input.lsl --json
```

**Bundle mode (from bundle_exporter.py):**
```bash
node /home/ubuntu/scripter/dist/transpiler/cli.js bundle manifest.json \
  --scripts-dir ./assets/scripts/ --json
```

**Python integration:**
```python
import subprocess, json

result = subprocess.run(
    ["node", "/home/ubuntu/scripter/dist/transpiler/cli.js",
     "transpile", script_path, "--json"],
    capture_output=True, text=True
)
data = json.loads(result.stdout)
if data["success"]:
    transpiled_source = data["code"]
    class_name = data["className"]
```

### Open Questions for Legacy Team

- [ ] **virtuallyHuman test:** Can we run the 60-script virtuallyHuman OAR through the CLI to validate real-world patterns?
- [ ] **Pre-transpile flag:** Should `bundle_exporter.py` add a `--pre-transpile` option that calls the CLI?
- [ ] **Manifest update:** Should we add `statistics.pre_transpiled: true` to the manifest when pre-transpilation succeeds?

---

## For Landscaper Team

### How Scripter Affects You

Landscaper populates worlds with trees, rocks, NPCs, particles, and weather. Scripts bring these objects to life.

**Example:** A Landscaper-placed tree could have an attached script:
```typescript
export default class WindyTree extends WorldScript {
  states = {
    default: {
      async onWeatherChange(weather: string) {
        if (weather === "windy") {
          this.object.playAnimation("sway", { loop: true });
        }
      }
    }
  };
}
```

### Integration Points

| Landscaper Feature | Script Connection |
|-------------------|-------------------|
| NPC placement | Scripts control NPC behavior (patrol, greet, vendor) |
| Particle emitters | Scripts can trigger/modify particle effects |
| Weather system | `onWeatherChange` event fires when weather changes |
| Day/night cycle | `onDayNightCycle` event fires on transitions |
| Scatter groups | Scripts could be attached per-scatter-layer |

### Open Questions for Landscaper Team

- [ ] **Per-layer scripts:** Should scatter layers support a `script` property that auto-attaches to spawned objects?
- [ ] **NPC scripts:** Should Landscaper's NPC placement pass script bindings through the manifest?

---

## Technical Summary

### What's in the Box (489 tests, all passing)

| Module | Size | What |
|--------|------|------|
| Types | 8 files | Vector3, Quaternion, WorldScript, Agent, NPC, Companion |
| World API | 179 mappings | Structured TypeScript API replacing LSL's flat `ll*` functions |
| Runtime | 72 tests | Web Worker pool, SES sandbox, AST transform, timers, link messages |
| Transpiler | 283 tests | Hand-written lexer/parser/codegen, type tracking, 50+ function handlers |
| Editor | — | Monaco with IntelliSense, dual TS/LSL mode, dark theme |
| Integration | 118 tests | Protocol types, bundle pipeline, ScriptHostAdapter facade |
| CLI | 16 tests | `transpile` + `bundle` commands, JSON output for automation |

### Server Footprint

- **No ports consumed** (editor is static, CLI is a command-line tool)
- **No PM2/systemd services** added
- **No database changes**
- Apache: one `Alias /scripter` directive added to `sites-available/poqpoq-ssl.conf`

### Repository

- **GitHub:** https://github.com/increasinglyHuman/BlackBoxScripter
- **Local:** `/home/p0qp0q/blackbox/BlackBoxScripter/`
- **Server CLI:** `/home/ubuntu/scripter/`
- **Server Editor:** `/var/www/scripter/`

---

## Action Items

### Immediate (This Week)

1. **World:** Test loading a proper WorldScript class via `bbWorldsApp.scripting.loadScript()`
2. **Legacy:** Run virtuallyHuman OAR through the CLI bundle command
3. **Scripter:** Add example script library (20+ scripts for common patterns)

### Near-Term

4. **World + Scripter:** Wire editor into World's builder UI (iframe or route)
5. **Legacy + Scripter:** Add `--pre-transpile` flag to `bundle_exporter.py`
6. **Landscaper + Scripter:** Define script attachment model for scatter layers

---

*This document lives in `docs/team-briefs/` in the BlackBoxScripter repo. Teams should respond by updating their own team-brief or opening issues on the Scripter repo.*
