//! Terminal state engine — Rust-side parser/grid behind the `TerminalEngine`
//! trait. See docs/implement/2026-05-16-alacritty-terminal-engine/ for the
//! full run context.

pub mod alacritty;
pub mod ipc;
pub mod pty_bridge;
pub mod selection; // cycle-17: AC-2 selection + clipboard parity
pub mod trait_def;
pub mod types;

#[cfg(test)]
mod alacritty_tests;
#[cfg(test)]
mod e2e_tests;
#[cfg(test)]
mod ipc_tests;
#[cfg(test)]
mod pty_bridge_tests;
#[cfg(test)]
mod selection_tests; // cycle-17
