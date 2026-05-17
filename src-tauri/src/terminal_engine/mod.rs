//! Terminal state engine — Rust-side parser/grid behind the `TerminalEngine`
//! trait. See docs/implement/2026-05-16-alacritty-terminal-engine/ for the
//! full run context.

pub mod alacritty;
pub mod input;
pub mod ipc;
pub mod osc7;
pub mod pty_bridge;
pub mod search;
pub mod selection;
pub mod trait_def;
pub mod types;

#[cfg(test)]
mod alacritty_tests;
#[cfg(test)]
mod e2e_tests;
#[cfg(test)]
mod input_tests;
#[cfg(test)]
mod ipc_tests;
#[cfg(test)]
mod pty_bridge_tests;
#[cfg(test)]
mod selection_tests;
