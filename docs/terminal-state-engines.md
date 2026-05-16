# Terminal State Engine Comparison: libghostty-vt vs alacritty_terminal

Reference comparison of the two viable Rust terminal-state-engine crates for
gnar-term's eventual move out of xterm.js. Last updated 2026-05-16.

This doc is intentionally evenhanded. Both libraries are credible choices; the
right answer depends on which axes matter most to gnar-term at the time of the
decision.

---

## At a glance

|                                   | `libghostty-vt`                                   | `alacritty_terminal`                 |
| --------------------------------- | ------------------------------------------------- | ------------------------------------ |
| Origin                            | Ghostty's VT engine, factored out                 | Alacritty's `Term<T>`, factored out  |
| Current version                   | 0.1.1 (2026-03-28)                                | 0.26.0 (2026-04-06)                  |
| License                           | MIT / Apache-2.0                                  | Apache-2.0                           |
| Stability promise                 | "Functionality stable, API in flux" (Mitchell H.) | De-facto stable; Zed depends in prod |
| Build                             | Rust + `libghostty-vt-sys` (C FFI, Zig upstream)  | Pure Rust + `vte`                    |
| Threading                         | `!Send + !Sync`                                   | `Send + Sync` (when listener is)     |
| Platforms                         | macOS, Linux                                      | macOS, Linux, Windows                |
| Public Rust API                   | community wrapper (`Uzaaft/libghostty-rs`)        | first-party crate from Alacritty org |
| Production Rust consumers (today) | none directly                                     | Alacritty, Zed                       |

cmux is sometimes cited as a libghostty consumer. To be precise: cmux links
**full libghostty** (the rendered terminal, GPU surfaces, AppKit views) in a
Swift app — not `libghostty-vt`. The only documented `libghostty-vt`
production consumer is Coder's `libghostty-vt-node` (Node-API shim, pinned to
a specific upstream commit because the ABI is unstable).

---

## What each library _is_

### `libghostty-vt`

A standalone parser + terminal-state engine extracted from Ghostty. Headers
live at `include/ghostty/vt/*.h`:

- `terminal.h` — terminal lifecycle, `feed`, resize, snapshot
- `grid_ref.h` — cell-grid reading
- `screen.h` — primary/alt screen state
- `osc.h` — OSC command dispatch types
- `sgr.h`, `style.h` — SGR + styling
- `kitty_graphics.h` — Kitty graphics protocol payloads (26KB header alone)
- `key.h`, `mouse.h` — first-class input encoders
- `formatter.h`, `wasm.h` — output formatting + Wasm targets

The library itself does **no rendering**, owns **no PTY**, and provides no
widget. You drive it with raw bytes and read the grid back. Mitchell's intent
is explicit: it's the parser/state half of Ghostty, made reusable.

### `alacritty_terminal`

The `Term<T>` crate factored out of Alacritty. Same shape — parser + state +
grid, no rendering, no PTY ownership. Where Ghostty's split is recent and
intentional, Alacritty's is older and accidental: the crate exists because
Alacritty's renderer was always separate from its terminal core, and others
(Zed) wanted to reuse the core.

Composition is `vte::Processor` (Paul Williams parser) + `Term<T>` (state +
grid). You call `parser.advance(&mut term, &bytes)` to feed.

---

## API shape, side by side

### Construction

```rust
// libghostty-vt
let term = Terminal::new(TerminalOptions {
    cols: 80,
    rows: 24,
    // …
})?;

// alacritty_terminal
let term: Term<MyListener> = Term::new(config, &size, listener);
let mut parser = vte::Processor::new();
```

`Term` is generic over a listener type that receives events (`Event::Title`,
`Event::ClipboardStore`, `Event::PtyWrite`, …). libghostty-vt instead exposes
structured types (`osc::CommandType`, `RowSemanticPrompt`) that you read off
the terminal — events are polled, not pushed.

### Feeding bytes

```rust
// libghostty-vt
term.feed(&bytes);

// alacritty_terminal
parser.advance(&mut term, &bytes);
```

Both are zero-copy slice-in. Alacritty's split-parser model means the parser
is reusable across multiple `Term`s; libghostty-vt's parser is per-terminal.

### Reading the grid

```rust
// libghostty-vt — snapshot pattern
let render = term.render_state();
for row in render.rows() {
    for cell in row.cells() { /* … */ }
}

// alacritty_terminal — damage rects + iterator
for damage_rect in term.damage() { /* mark dirty */ }
for row in term.renderable_content().display_iter { /* … */ }
```

Both expose damage. libghostty-vt's `Dirty` flag returns after `feed()`;
alacritty's `damage()` returns explicit rects. Slight ergonomic edge to
alacritty here.

### Input encoding (keyboard, mouse)

```rust
// libghostty-vt
let bytes = key::Encoder::new(opts).encode(&key_event)?;

// alacritty_terminal
// crate does not include encoders; host implements
// (Alacritty's encoder lives in alacritty/alacritty_input, not in the crate)
```

This is libghostty-vt's biggest architectural advantage. First-class Kitty
keyboard, modify-other-keys, mouse modes (1000/1002/1003/1006 + SGR-Pixels)
are all bundled. With alacritty_terminal you write or port these yourself —
Zed did, and it's nontrivial.

### OSC dispatch

```rust
// libghostty-vt
match osc_cmd.kind() {
    osc::CommandType::ChangeWindowTitle => …,
    osc::CommandType::ReportCwd => …,
    osc::CommandType::Hyperlink => …,
    osc::CommandType::SemanticPrompt => …,  // OSC 133
    // …
}

// alacritty_terminal
// fires Event::Title / ClipboardStore / ColorRequest / PtyWrite / …
// no Event variant for OSC 7 (cwd) or OSC 133 (prompt marks)
```

This is alacritty's notable gap. OSC 7 is parsed internally but not surfaced
as an `Event`. OSC 133 has no representation at all. Workable — you patch the
crate or tap the parser — but it's not free.

---

## Feature matrix

| Feature                                    | `libghostty-vt` 0.1.1          | `alacritty_terminal` 0.26      |
| ------------------------------------------ | ------------------------------ | ------------------------------ |
| VT100 / VT220 / xterm core                 | Yes                            | Yes                            |
| OSC 0/2 title                              | Yes                            | Yes (`Event::Title`)           |
| OSC 7 cwd                                  | Yes (first-class)              | Parsed, no event surfaced      |
| OSC 8 hyperlinks                           | Yes                            | Yes (`Cell.hyperlink`)         |
| OSC 52 clipboard                           | Yes                            | Yes (`Event::ClipboardStore`)  |
| OSC 133 prompt marks                       | Yes (`RowSemanticPrompt`)      | No event surfaced              |
| Kitty graphics protocol                    | Yes                            | No                             |
| Sixel graphics                             | Yes                            | No (ayosec fork only)          |
| iTerm2 inline images                       | Yes                            | No                             |
| Kitty keyboard protocol                    | Yes (`key::Encoder` bundled)   | Yes (parse side)               |
| Modify-other-keys / win32 input            | Yes                            | Yes                            |
| Bracketed paste                            | Yes (with safety hooks)        | Yes                            |
| Mouse modes 1000/1002/1003/1006            | Yes (+ SGR-Pixels, urxvt)      | Yes                            |
| Synchronized output (DEC 2026)             | Yes                            | Yes (since 0.13)               |
| Reflow on resize                           | Yes                            | Yes (in-place)                 |
| Grapheme clusters (ZWJ, flags, skin tones) | Yes                            | Yes (Unicode 17)               |
| Bidi                                       | No                             | No                             |
| DECRQM / DECRQSS                           | Partial                        | Partial                        |
| IME composition                            | No (host's job)                | No (host's job)                |
| Key/mouse encoders bundled                 | **Yes**                        | **No** — host implements       |
| Damage tracking                            | `Dirty` flag + render snapshot | `damage()` rects               |
| Search API                                 | No (you implement on the grid) | No (you implement on the grid) |

The lines worth weighing for gnar-term:

- libghostty-vt wins on **inline images** (Kitty/Sixel/iTerm2), **OSC 133**
  semantics, and **input encoders bundled**.
- alacritty_terminal wins on **stability**, **build simplicity**, **Send/Sync**,
  and **Windows** support.

---

## Maturity & stability

### `libghostty-vt`

- 0.1.1, released 2026-03-28. ~82 commits in the Rust wrapper repo.
- Upstream C ABI is **explicitly marked unstable** — `include/ghostty/vt/*`
  headers say "This is an incomplete, work-in-progress API. It is not yet
  stable and is definitely going to change."
- Mitchell's framing (Sept 2025 blog post + later): functionality is stable,
  API signatures are not. Target for 1.0: within ~6 months of the Sept-2025
  post — realistically late 2026.
- No first-party Rust crate. The Rust binding is `Uzaaft/libghostty-rs`, a
  community wrapper (`libghostty-vt` + `libghostty-vt-sys`).
- Production Rust consumers: none I can find. Coder's Node binding is the
  only production consumer at all, and they pin a specific commit precisely
  because of the ABI instability.

### `alacritty_terminal`

- 0.26.0, released 2026-04-06 alongside Alacritty 0.17.0. Release cadence
  ~6 months.
- No formal semver promise but treated as stable by downstream. Zed has
  depended on it for years; the `ZedListener` bridge is a stable shape.
- First-party crate published by the Alacritty org.
- Production Rust consumers: Alacritty itself, Zed, several smaller terminal
  multiplexers and embedded-terminal use cases.

---

## Build & integration

### `libghostty-vt`

- Adds `libghostty-vt-sys` (C/Zig sys crate) to your dependency graph.
  Upstream is built in Zig; the sys crate vendors the artifact.
- CI implications for a Tauri release pipeline: extra build complexity, more
  things to break on a clean macOS/Linux build agent.
- No Windows support today (Ghostty has no Windows target).
- Cross-compilation story is unproven for embedders.

### `alacritty_terminal`

- Pure Rust. `cargo add alacritty_terminal` and you're done.
- No C/Zig toolchain. Cross-compiles cleanly.
- Windows works today (Alacritty ships on Windows).
- Fast to compile, no native artifacts in your bundle.

If gnar-term cares about Linux, build determinism, or eventually Windows,
this axis matters a lot.

---

## Performance

Neither library publishes head-to-head benchmarks. Both are proven on
multi-MB/s firehose output (Ghostty 1.x and Alacritty have shipped at scale).

- **alacritty_terminal**: Vec-of-rows grid; rare attributes (hyperlink,
  underline color) stored in an `Arc<CellExtra>` to keep the hot cell at
  16–32 bytes. Reflow on resize is in-place, O(rows × cols). Explicit
  `damage()` API for incremental render.
- **libghostty-vt**: internals are less observable. `Dirty` enum after
  `feed()`, render-snapshot pattern (allocate once, iterate). Optional SIMD
  parser path (`LIBGHOSTTY_VT_SIMD=true` in the Node binding; equivalent
  feature flag on the Rust side).

For gnar-term's scale (≤16 panes, occasional bursts during `cat` of large
files), both are over-spec. Performance is not the deciding factor.

---

## Production consumers (Rust)

- `libghostty-vt`: none of significant scale. The Coder Node binding
  (libghostty-vt-node) is the canonical real-world deployment, but that's
  via N-API, not Rust.
- `alacritty_terminal`: Alacritty itself; Zed (terminal panel); a long tail
  of smaller projects.

Practical implication: if you hit a tricky API question on alacritty, the
answer probably exists in Zed's source. For libghostty-vt the answer
probably doesn't exist yet, and you're emailing Mitchell or filing an issue.

---

## Migration impact for gnar-term

Both libraries put gnar-term in the same overall architecture: PTY bytes
arrive in Rust → state engine consumes them → grid diffs ship over Tauri IPC
→ Svelte renders cells (canvas/WebGL/DOM). The IPC and renderer cost is the
same either way; the engine swap is the interesting variable.

### With `alacritty_terminal`

Free out of the box: scroll history, OSC 8 hyperlinks (in `Cell.hyperlink`),
Kitty keyboard parsing, bracketed paste, mouse modes, grapheme widths,
synchronized output, regex search primitives.

You add: a webview canvas/WebGL renderer (replaces xterm's `addon-webgl`),
cols/rows fit math in JS (replaces `addon-fit`), key/mouse **encoders**
(alacritty doesn't ship these — port from Alacritty or write fresh), OSC 7
surfacing (patch the crate or tap the parser), OSC 133 same. Inline images
are a permanent No without forking.

### With `libghostty-vt`

Free out of the box: everything above, plus first-class OSC 7 + OSC 133,
plus Kitty graphics / Sixel / iTerm2 images, plus bundled key/mouse
encoders.

You add: same webview renderer + fit math + key intercept, plus an
image-payload pipeline (raster bytes ship over a separate IPC channel keyed
by id), plus you channel-message into the terminal (it's `!Send + !Sync`).

### Risk asymmetry

- `alacritty_terminal`: API drifts maybe once every two releases; Zed
  handles the same drift; the worst case is a few hours of fixup.
- `libghostty-vt`: any release between now and 1.0 may break you. The C ABI
  is the unstable layer, so a `libghostty-vt-sys` bump can require an entire
  Rust wrapper rev. Coder pins exactly because of this.

---

## When to pick which

### Pick `alacritty_terminal` if…

- You want to ship the migration in the next 6 months.
- You care about Windows now or later.
- You don't have inline images on the near-term roadmap.
- You want one Rust crate, no C/Zig in your build graph.
- You're comfortable porting input encoders (or already have JS-side ones
  to keep using).

### Pick `libghostty-vt` if…

- Inline images (Kitty graphics or Sixel) are a real product requirement.
  This is the single feature that genuinely tips the balance.
- OSC 133 prompt-region semantics matter for an agent-workflow UI you want
  to build on top (prompt boundaries, command extraction, exit-code
  awareness).
- You're prepared to track an unstable upstream and pin commits.
- You don't need Windows.

### Don't pick yet if…

- The current xterm.js integration is shallow enough that the cost of
  migration outweighs the gain — gnar-term's surface is two files and four
  addons today, which is a moderate but not trivial swap. The product
  question ("does rendering quality move the needle?") is upstream of the
  library question.

---

## The escape hatch: keep the swap-point neutral

Whichever you pick, hide it behind a trait. Something like:

```rust
trait TerminalEngine {
    fn feed(&mut self, bytes: &[u8]);
    fn resize(&mut self, cols: u16, rows: u16);
    fn snapshot(&self) -> GridSnapshot;
    fn damage(&self) -> Vec<DamageRect>;
    fn encode_key(&self, ev: &KeyEvent) -> Vec<u8>;
    fn encode_mouse(&self, ev: &MouseEvent) -> Vec<u8>;
    // …
}
```

Implement it twice. Ship one, keep the other plausible. The day
libghostty-vt tags 1.0 (or alacritty stops being maintained — unlikely but
possible), the migration is one impl swap, not a re-architecture. The
features that differ between the engines (inline images, OSC 133 events)
live on top of the trait, gated by capability flags.

This is overhead, but small overhead. It's the only way to commit today
without locking the decision forever.

---

## References

- libghostty-vt headers — https://github.com/ghostty-org/ghostty/tree/main/include/ghostty/vt
- libghostty-vt docs site — https://libghostty.tip.ghostty.org/
- libghostty-vt Rust crate (docs.rs) — https://docs.rs/libghostty-vt
- Uzaaft/libghostty-rs (FFI + safe wrappers) — https://github.com/Uzaaft/libghostty-rs
- coder/libghostty-vt-node (ABI-stable N-API bindings) — https://github.com/coder/libghostty-vt-node
- "Libghostty Is Coming" (Mitchell Hashimoto, 2025-09) — https://mitchellh.com/writing/libghostty-is-coming
- alacritty_terminal on docs.rs — https://docs.rs/alacritty_terminal
- Alacritty CHANGELOG — https://github.com/alacritty/alacritty/blob/master/CHANGELOG.md
- Cell struct (alacritty_terminal) — https://docs.rs/alacritty_terminal/latest/alacritty_terminal/term/cell/struct.Cell.html
- Event enum (alacritty_terminal) — https://docs.rs/alacritty_terminal/latest/alacritty_terminal/event/enum.Event.html
- Zed terminal architecture (DeepWiki) — https://deepwiki.com/zed-industries/zed/9.1-terminal-core
- Ghostty OSC reference — https://deepwiki.com/ghostty-org/ghostty/3.4-osc-commands-and-protocols
- Are We Sixel Yet — https://www.arewesixelyet.com/
