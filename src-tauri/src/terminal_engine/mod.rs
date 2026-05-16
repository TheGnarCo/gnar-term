//! Terminal state engine — Rust-side parser/grid behind the `TerminalEngine`
//! trait. See docs/implement/2026-05-16-alacritty-terminal-engine/ for the
//! full run context.

pub mod alacritty;
pub mod ipc;
pub mod trait_def;
pub mod types;

#[cfg(test)]
mod alacritty_tests;
#[cfg(test)]
mod ipc_tests;
