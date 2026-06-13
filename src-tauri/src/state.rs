use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU32};
use std::sync::{Arc, Mutex};
use portable_pty::MasterPty;

pub(crate) static NEXT_PTY_ID: AtomicU32 = AtomicU32::new(1);
pub(crate) static NEXT_WATCH_ID: AtomicU32 = AtomicU32::new(1);

/// Shared pause state — uses a Condvar so the reader thread blocks efficiently
/// instead of spin-waiting when the frontend signals backpressure.
pub(crate) struct PauseFlag {
    mu: std::sync::Mutex<bool>,
    cv: std::sync::Condvar,
}

impl PauseFlag {
    pub(crate) fn new() -> Self {
        Self { mu: std::sync::Mutex::new(false), cv: std::sync::Condvar::new() }
    }
    pub(crate) fn pause(&self) {
        *self.mu.lock().unwrap_or_else(|e| e.into_inner()) = true;
    }
    pub(crate) fn resume(&self) {
        *self.mu.lock().unwrap_or_else(|e| e.into_inner()) = false;
        self.cv.notify_one();
    }
    pub(crate) fn wait_if_paused(&self) {
        let guard = self.mu.lock().unwrap_or_else(|e| e.into_inner());
        // Block until paused == false (no CPU burn)
        let _guard = self.cv.wait_while(guard, |paused| *paused)
            .unwrap_or_else(|e| e.into_inner());
    }
}

pub(crate) struct PtyInstance {
    pub(crate) writer: Box<dyn Write + Send>,
    // master is kept alive to keep the PTY open
    pub(crate) _master: Box<dyn MasterPty + Send>,
    pub(crate) child_pid: Option<u32>,
    pub(crate) paused: std::sync::Arc<PauseFlag>,
}

pub(crate) struct AppState {
    pub(crate) ptys: Mutex<HashMap<u32, PtyInstance>>,
    pub(crate) watch_flags: Mutex<HashMap<u32, Arc<AtomicBool>>>,
}

#[derive(Clone, Serialize)]
pub(crate) struct PtyNotification {
    pub(crate) pty_id: u32,
    pub(crate) text: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct PtyTitle {
    pub(crate) pty_id: u32,
    pub(crate) title: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct PtyExit {
    pub(crate) pty_id: u32,
}

#[derive(Clone, Serialize)]
pub(crate) struct FileChanged {
    pub(crate) watch_id: u32,
    pub(crate) path: String,
    pub(crate) content: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[test]
    fn pause_flag_blocks_and_resumes() {
        let flag = Arc::new(PauseFlag::new());
        let flag2 = flag.clone();

        flag.pause();

        // Spawn a thread that will wait on the flag
        let handle = std::thread::spawn(move || {
            let start = Instant::now();
            flag2.wait_if_paused();
            start.elapsed()
        });

        // Give the thread time to block
        std::thread::sleep(Duration::from_millis(50));

        // Resume — the thread should unblock
        flag.resume();

        let elapsed = handle.join().unwrap();
        assert!(elapsed >= Duration::from_millis(40), "Thread should have blocked ~50ms, got {:?}", elapsed);
        assert!(elapsed < Duration::from_millis(500), "Thread should resume quickly, got {:?}", elapsed);
    }

    #[test]
    fn pause_flag_does_not_block_when_not_paused() {
        let flag = PauseFlag::new();
        let start = Instant::now();
        flag.wait_if_paused();
        assert!(start.elapsed() < Duration::from_millis(5), "Should not block");
    }
}
