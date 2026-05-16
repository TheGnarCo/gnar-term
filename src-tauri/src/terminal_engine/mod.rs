//\! Terminal state engine — Rust-side parser/grid behind the `TerminalEngine`
//\! trait. Phase 1 introduces only the module skeleton + dependency wiring;
//\! cycle-2 fills in the trait and the `AlacrittyEngine` concrete impl.
//\!
//\! See `docs/implement/2026-05-16-alacritty-terminal-engine/intent.md` and
//\! `plan.md` for the full run plan, and `scaffold/0001-…` (trait shape),
//\! `scaffold/0002-…` (wire format), `scaffold/0003-…` (channel topology)
//\! for the load-bearing decisions.

#[cfg(test)]
mod tests {
    /// AC-1: `alacritty_terminal` is on the dependency graph.
    ///
    /// The `extern crate` form is the shortest assertion that the crate
    /// name resolves. If `Cargo.toml` lacks the entry, this file fails
    /// to compile and `cargo check` fails — that's the test's failure
    /// mode. The runtime test body is intentionally empty; compilation
    /// is the assertion.
    #[allow(unused_extern_crates)]
    extern crate alacritty_terminal as _alacritty_dep_check;

    #[test]
    fn alacritty_terminal_crate_resolves() {
        // No runtime body — the `extern crate` declaration above is the test.
    }
}
