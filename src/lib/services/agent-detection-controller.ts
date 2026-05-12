/**
 * agent-detection-controller — service lifecycle + event wiring.
 *
 * Subscribes to surface/workspace events on the global event bus and to
 * the typed OSC notification store, keeps a closure-scoped
 * `trackedSurfaces` map of every observed terminal, and invokes
 * `attachAgent` / `detachAgent` from the publish slice as titles, output,
 * and OSC notifications arrive.
 *
 * Holds no module-level state besides the singleton service handle so a
 * second `initAgentDetection()` call cleanly tears down the previous
 * instance (HMR + test idempotency).
 */
import { eventBus } from "./event-bus";
import {
  addOutputObserver,
  removeOutputObserver,
} from "./surface-output-observer";
import { workspaces } from "../stores/workspace";
import { lookupPaneIntendedAgent } from "./pane-lookup";
import {
  oscNotificationStore,
  feedPaneOutput,
  resetOscNotificationStoreForTests,
} from "./osc-notification-service";
import { _registry } from "./agent-detection-registry";
import {
  applyPaneStateEvent,
  clearPaneAgentEntry,
  deletePaneStateEntry,
  getPaneAgentEntry,
  hasPaneAgentEntry,
  initPaneStateIfAbsent,
  oscKindToStateEvent,
  resetPaneStores,
  setPaneAgentEntry,
} from "./agent-detection-state-store";
import {
  allTerminalSurfaces,
  classifyFromSurfaceCommand,
  loadIdleTimeoutMs,
  loadPatternList,
  matchesPattern,
  resolvePtyIdForSurface,
  resolveWorkspaceIdForSurface,
  type AgentPattern,
} from "./agent-detection-patterns";
import {
  attachAgent,
  detachAgent,
  publishStatus,
  sweepAgentRegistry,
  ALT_SCREEN_ENTER_RE,
  ALT_SCREEN_EXIT_RE,
  TITLE_DETACH_DEBOUNCE_MS,
  type TrackedSurface,
} from "./agent-detection-publish";

// Default heartbeat idle timeout for the state machine (ms).
const HEARTBEAT_IDLE_TIMEOUT_MS = 5_000;

interface ServiceHandle {
  destroy: () => void;
}

let _current: ServiceHandle | null = null;

/**
 * Start the agent detection service. Idempotent — calling again tears
 * down the previous instance first (so HMR and tests don't stack
 * observers).
 */
export function initAgentDetection(): void {
  if (_current) {
    _current.destroy();
    _current = null;
  }

  const trackedSurfaces = new Map<string, TrackedSurface>();
  const cleanups: Array<() => void> = [];
  const patterns = loadPatternList();
  const idleTimeoutMs = loadIdleTimeoutMs();

  // Per-pane heartbeat timers: if no output is observed for
  // HEARTBEAT_IDLE_TIMEOUT_MS, emit heartbeat_idle.
  const heartbeatTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function resetHeartbeat(paneId: string): void {
    const existing = heartbeatTimers.get(paneId);
    if (existing !== undefined) clearTimeout(existing);
    heartbeatTimers.set(
      paneId,
      setTimeout(() => {
        heartbeatTimers.delete(paneId);
        applyPaneStateEvent(paneId, { kind: "heartbeat_idle" });
      }, HEARTBEAT_IDLE_TIMEOUT_MS),
    );
    // Emit heartbeat_output immediately (output was just observed).
    applyPaneStateEvent(paneId, { kind: "heartbeat_output" });
  }

  function clearHeartbeat(paneId: string): void {
    const existing = heartbeatTimers.get(paneId);
    if (existing !== undefined) {
      clearTimeout(existing);
      heartbeatTimers.delete(paneId);
    }
  }

  /** Try argv-based classification first (strongest signal), fall back to
   *  the intendedAgent heuristic. Only writes when nothing is recorded yet. */
  function seedPaneAgentTypeIfAbsent(paneId: string, surfaceId: string): void {
    if (hasPaneAgentEntry(paneId)) return;
    const argvType = classifyFromSurfaceCommand(surfaceId);
    if (argvType !== null) {
      setPaneAgentEntry(paneId, {
        agentType: argvType,
        confidence: "argv",
        detectedAt: new Date().toISOString(),
      });
      return;
    }
    const hint = lookupPaneIntendedAgent(paneId);
    if (hint !== null) {
      setPaneAgentEntry(paneId, {
        agentType: hint,
        confidence: "heuristic",
        detectedAt: new Date().toISOString(),
      });
    }
  }

  const attachToSurface = (
    surfaceId: string,
    initialTitle: string,
    knownPaneId?: string,
  ): void => {
    if (trackedSurfaces.has(surfaceId)) return;

    const resolvedPty = resolvePtyIdForSurface(surfaceId);
    // A terminal surface emits `surface:created` with ptyId = -1 — the
    // real id is only assigned once connectPty resolves. Treat -1 as
    // "not ready yet" and defer observer wiring to surface:ptyReady.
    const tracked: TrackedSurface = {
      surfaceId,
      paneId: knownPaneId ?? null,
      ptyId: resolvedPty !== null && resolvedPty >= 0 ? resolvedPty : null,
      wiredPtyId: null,
      agentId: null,
      agentPattern: null,
      tracker: null,
      unsubscribeOutput: null,
      lastKnownTitle: initialTitle || undefined,
      detachTimer: null,
    };
    trackedSurfaces.set(surfaceId, tracked);

    // Initialize the pane state entry as soon as we know the paneId.
    if (tracked.paneId) {
      initPaneStateIfAbsent(tracked.paneId);
    }

    const initialMatch = matchesPattern(initialTitle, patterns);
    if (initialMatch) {
      attachAgent(tracked, initialMatch, idleTimeoutMs);
    } else if (tracked.paneId) {
      // No title-match detection yet. A confirmed detection (via attachAgent)
      // will overwrite this entry later with osc/title confidence reflecting
      // the actual signal.
      seedPaneAgentTypeIfAbsent(tracked.paneId, tracked.surfaceId);
    }

    if (tracked.ptyId !== null) {
      wireObserver(tracked);
    }
  };

  const wireObserver = (tracked: TrackedSurface): void => {
    if (tracked.ptyId === null) return;
    // If an observer was already wired but the pty id changed (e.g. a
    // surface:ptyReady fired twice because spawn retried), tear the old
    // one down so we don't leak an observer pointed at a stale pty.
    if (tracked.unsubscribeOutput) {
      if (tracked.wiredPtyId === tracked.ptyId) return;
      tracked.unsubscribeOutput();
      tracked.unsubscribeOutput = null;
    }
    const ptyId = tracked.ptyId;
    // OSC sequences can arrive split across chunk boundaries (e.g. `\x1b]`
    // in one chunk, `9;...` in the next). Carry the last 8 bytes of the
    // previous chunk so the regex sees a complete preamble even when split.
    let oscTailBuffer = "";
    const OSC_PREAMBLE_MAX = 8;
    const observer = (data: string) => {
      const probe = oscTailBuffer + data;
      oscTailBuffer = probe.slice(-OSC_PREAMBLE_MAX);
      // Heartbeat: any output resets the idle debounce for the pane
      // state machine (→ heartbeat_output now, heartbeat_idle after timeout).
      if (tracked.paneId) {
        resetHeartbeat(tracked.paneId);
      }
      try {
        // Any output ticks an attached tracker. Notification-class OSCs
        // (9 / 99 / 777) flip the tracker to "waiting" via the typed
        // oscNotificationStore subscription below, which fires
        // synchronously when feedPaneOutput parses a complete sequence.
        // Order matters: onOutput first so onNotification (if any) wins.
        tracked.tracker?.onOutput();
        if (tracked.paneId) {
          feedPaneOutput(tracked.paneId, probe);
        }
        if (tracked.tracker) {
          // OSC-detectable harnesses (Claude Code, Codex, …) live in the
          // alternate screen. The shell often doesn't re-emit an OSC title
          // after the harness quits, so the title-mismatch detach path is
          // unreliable. Watching the alt-screen exit sequence gives a
          // strong "harness ended" signal independent of the shell. Entry
          // back into the alt screen cancels a pending detach so that
          // brief mid-session escapes (e.g. a pager) don't drop the agent.
          if (tracked.agentPattern?.oscDetectable && tracked.agentId) {
            if (ALT_SCREEN_ENTER_RE.test(probe) && tracked.detachTimer) {
              clearTimeout(tracked.detachTimer);
              tracked.detachTimer = null;
            } else if (
              ALT_SCREEN_EXIT_RE.test(probe) &&
              tracked.detachTimer === null
            ) {
              tracked.detachTimer = setTimeout(() => {
                tracked.detachTimer = null;
                detachAgent(tracked);
              }, TITLE_DETACH_DEBOUNCE_MS);
            }
          }
        } else {
          // OSC-detectable agents (e.g. Claude Code) are identified by PTY
          // title changes only — matching raw output causes false positives
          // when compilation output contains the pattern string.
          const nonOscPatterns = patterns.filter(
            (p: AgentPattern) => !p.oscDetectable,
          );
          const match = matchesPattern(data, nonOscPatterns);
          if (match) {
            const currentTitle =
              allTerminalSurfaces().find((s) => s.id === tracked.surfaceId)
                ?.title ?? "";
            attachAgent(tracked, match, idleTimeoutMs, currentTitle);
          }
        }
      } catch (err) {
        console.error(
          "[agent-detection] output observer error",
          tracked.surfaceId,
          err,
        );
        if (tracked.agentId) {
          try {
            detachAgent(tracked);
          } catch {
            /* already reported */
          }
        }
      }
    };
    addOutputObserver(ptyId, observer);
    tracked.wiredPtyId = ptyId;
    tracked.unsubscribeOutput = () => removeOutputObserver(ptyId, observer);
  };

  const detachFromSurface = (surfaceId: string): void => {
    const tracked = trackedSurfaces.get(surfaceId);
    if (!tracked) return;
    if (tracked.detachTimer !== null) {
      clearTimeout(tracked.detachTimer);
      tracked.detachTimer = null;
    }
    if (tracked.agentId) detachAgent(tracked);
    if (tracked.unsubscribeOutput) tracked.unsubscribeOutput();
    // Clear the pane state entry and heartbeat timer on surface close.
    if (tracked.paneId) {
      clearHeartbeat(tracked.paneId);
      deletePaneStateEntry(tracked.paneId);
      clearPaneAgentEntry(tracked.paneId);
    }
    trackedSurfaces.delete(surfaceId);
  };

  const handleCreated = (event: {
    type: "surface:created";
    id: string;
    paneId: string;
    kind: string;
  }) => {
    if (event.kind !== "terminal") return;
    const surfaces = allTerminalSurfaces();
    const info = surfaces.find((s) => s.id === event.id);
    attachToSurface(event.id, info?.title ?? "", event.paneId);
  };
  const handleTitle = (event: {
    type: "surface:titleChanged";
    id: string;
    oldTitle: string;
    newTitle: string;
  }) => {
    const tracked = trackedSurfaces.get(event.id);
    if (!tracked) return;
    const match = matchesPattern(event.newTitle, patterns);
    if (match && !tracked.agentId) {
      if (tracked.detachTimer !== null) {
        clearTimeout(tracked.detachTimer);
        tracked.detachTimer = null;
      }
      attachAgent(tracked, match, idleTimeoutMs, event.oldTitle);
    } else if (match && tracked.agentId) {
      if (tracked.detachTimer !== null) {
        clearTimeout(tracked.detachTimer);
        tracked.detachTimer = null;
      }
      tracked.tracker?.onTitleChange(event.newTitle);
    } else if (!match && tracked.agentId) {
      // OSC-detectable agents (Claude Code, Codex, Aider) re-title to
      // the active task as they work — e.g. Claude's title becomes
      // "Strategic opportunity assessment for Vellum" with no
      // "claude" substring left. The authoritative "agent stopped"
      // signal for these is alt-screen exit; a title that no longer
      // matches just means the agent is busy. Capture the new title
      // for the running/done heuristic and stop there. Title-only
      // agents (e.g. Cursor) still detach on mismatch — title is
      // their only signal.
      if (tracked.agentPattern?.oscDetectable) {
        tracked.tracker?.onTitleChange(event.newTitle);
      } else if (tracked.detachTimer === null) {
        tracked.detachTimer = setTimeout(() => {
          tracked.detachTimer = null;
          detachAgent(tracked);
        }, TITLE_DETACH_DEBOUNCE_MS);
      }
    }
    tracked.lastKnownTitle = event.newTitle;
  };
  const handleClosed = (event: { type: "surface:closed"; id: string }) => {
    detachFromSurface(event.id);
  };
  const handleWorkspaceClosed = (event: {
    type: "workspace:closed";
    id: string;
  }) => {
    // closeWorkspace() disposes surfaces and emits workspace:closed but does
    // NOT fire surface:closed for each terminal, so handleClosed never runs
    // for those surfaces. Sweep all tracked surfaces whose agent belongs to
    // the closing workspace so they don't linger as "idle".
    const toDetach: string[] = [];
    for (const [surfaceId, tracked] of trackedSurfaces) {
      if (!tracked.agentId) continue;
      const agent = _registry.find(tracked.agentId);
      if (agent?.workspaceId === event.id) toDetach.push(surfaceId);
    }
    for (const surfaceId of toDetach) detachFromSurface(surfaceId);
  };
  const handlePtyReady = (event: {
    type: "surface:ptyReady";
    id: string;
    ptyId: number;
  }) => {
    // surface:created fires with a placeholder ptyId = -1 (the PTY
    // isn't spawned until after the xterm is fit-sized), so the
    // observer was previously pointed at a non-existent pty id and
    // never received data. Once the real id lands, backfill it and
    // wire the observer now.
    let tracked = trackedSurfaces.get(event.id);
    if (!tracked) {
      // Missed surface:created (e.g. init raced with a restore) —
      // attach now using the current title from the workspace store
      // (may be empty if workspaces haven't loaded yet) and fall
      // through to observer wiring.
      const surfaceInfo = allTerminalSurfaces().find((s) => s.id === event.id);
      attachToSurface(event.id, surfaceInfo?.title ?? "", surfaceInfo?.paneId);
      tracked = trackedSurfaces.get(event.id);
      if (!tracked) return;
    }
    // Backfill paneId if surface:created raced and didn't know it yet.
    if (!tracked.paneId) {
      const surfaceInfo = allTerminalSurfaces().find((s) => s.id === event.id);
      if (surfaceInfo?.paneId) {
        tracked.paneId = surfaceInfo.paneId;
        initPaneStateIfAbsent(tracked.paneId);
        if (tracked.agentId) {
          _registry.mutate(tracked.agentId, (agent) => {
            if (agent.paneId !== surfaceInfo.paneId) {
              agent.paneId = surfaceInfo.paneId;
            }
          });
        }
      }
    }
    tracked.ptyId = event.ptyId;
    wireObserver(tracked);
  };

  eventBus.on("surface:created", handleCreated);
  eventBus.on("surface:titleChanged", handleTitle);
  eventBus.on("surface:closed", handleClosed);
  eventBus.on("workspace:closed", handleWorkspaceClosed);
  eventBus.on("surface:ptyReady", handlePtyReady);
  cleanups.push(() => eventBus.off("surface:created", handleCreated));
  cleanups.push(() => eventBus.off("surface:titleChanged", handleTitle));
  cleanups.push(() => eventBus.off("surface:closed", handleClosed));
  cleanups.push(() => eventBus.off("workspace:closed", handleWorkspaceClosed));
  cleanups.push(() => eventBus.off("surface:ptyReady", handlePtyReady));

  // Bootstrap every pre-existing terminal surface — surface:created only
  // fires for surfaces created AFTER this listener attached, so restored
  // surfaces would otherwise be permanently untracked.
  for (const info of allTerminalSurfaces()) {
    attachToSurface(info.id, info.title, info.paneId);
  }

  // Re-detect agents when the workspace store is populated or updated.
  // Handles the startup race where surface events (surface:created,
  // surface:ptyReady) arrive before workspaces finish loading — at that
  // point allTerminalSurfaces() returned [] so surfaces were tracked
  // without agents. When workspaces load, this subscription re-checks
  // unattached surfaces against their now-known titles.
  const unsubWorkspaces = workspaces.subscribe(() => {
    // Build the surface-title and surface-paneId lookups once per emission
    // rather than calling allTerminalSurfaces() for each unattached surface
    // (O(W×P×S) vs. O(tracked × W×P×S) per emission — F12 perf fix).
    const surfaceTitleById = new Map<string, string>();
    const surfacePaneById = new Map<string, string>();
    for (const s of allTerminalSurfaces()) {
      surfaceTitleById.set(s.id, s.title);
      surfacePaneById.set(s.id, s.paneId);
    }
    for (const [, tracked] of trackedSurfaces) {
      // Backfill paneId when the workspace store becomes available.
      if (!tracked.paneId) {
        const resolvedPane = surfacePaneById.get(tracked.surfaceId);
        if (resolvedPane) {
          tracked.paneId = resolvedPane;
          initPaneStateIfAbsent(tracked.paneId);
          if (tracked.agentId) {
            _registry.mutate(tracked.agentId, (agent) => {
              if (agent.paneId !== resolvedPane) {
                agent.paneId = resolvedPane;
              }
            });
          }
          // Backfill agent-type entry if no detection yet.
          if (!tracked.agentId) {
            seedPaneAgentTypeIfAbsent(tracked.paneId, tracked.surfaceId);
          }
        }
      }
      if (tracked.agentId) {
        // Backfill the status item for agents attached before their workspace
        // was known — the initial publishStatus("idle") wrote nothing because
        // workspaceId was empty at that time.
        const agent = _registry.find(tracked.agentId);
        if (agent && !agent.workspaceId) {
          const resolved = resolveWorkspaceIdForSurface(tracked.surfaceId);
          if (resolved) {
            _registry.mutate(tracked.agentId, (a) => {
              a.workspaceId = resolved;
            });
            publishStatus(tracked, resolved, agent.status);
          }
        }
        // Also backfill paneAgentTypeStore if paneId was resolved above.
        if (tracked.paneId && tracked.agentPattern) {
          const existing = getPaneAgentEntry(tracked.paneId);
          if (!existing) {
            const agentType = tracked.agentPattern.agentType ?? "generic";
            const confidence = tracked.agentPattern.oscDetectable
              ? "osc"
              : "title";
            const agentForDetectedAt = _registry.find(tracked.agentId);
            setPaneAgentEntry(tracked.paneId, {
              agentType,
              confidence,
              detectedAt:
                agentForDetectedAt?.createdAt ?? new Date().toISOString(),
            });
          }
        }
        continue;
      }
      const currentTitle = surfaceTitleById.get(tracked.surfaceId) ?? "";
      if (!currentTitle) continue;
      const match = matchesPattern(currentTitle, patterns);
      if (match) {
        // If lastKnownTitle predates the agent pattern match, use it as the
        // pre-agent title so detachAgent can restore it on exit.
        const preTitle =
          tracked.lastKnownTitle &&
          !matchesPattern(tracked.lastKnownTitle, patterns)
            ? tracked.lastKnownTitle
            : undefined;
        attachAgent(tracked, match, idleTimeoutMs, preTitle);
      }
    }
  });
  cleanups.push(unsubWorkspaces);

  // Subscribe to the OSC notification store. Each new notification drives
  // both the per-pane state machine and — for OSC-detectable trackers
  // attached to that pane — the per-agent `tracker.onNotification` path
  // that flips `DetectedAgent.status` to "waiting". This is the single
  // source of OSC awareness; the observer just feeds raw output into the
  // typed parser via feedPaneOutput.
  let lastOscLen = 0;
  const unsubOsc = oscNotificationStore.subscribe((notifications) => {
    if (notifications.length <= lastOscLen) {
      // Store was reset (tests) or wrapped — reprocess all.
      lastOscLen = 0;
    }
    for (let i = lastOscLen; i < notifications.length; i++) {
      const n = notifications[i];
      if (!n) continue;
      applyPaneStateEvent(n.paneId, oscKindToStateEvent(n.kind));
      // Fan out to the per-tracker notification handler for OSC-detectable
      // agents whose pane matches this notification.
      const tracked = findTrackedByPaneId(n.paneId);
      if (tracked?.tracker && tracked.agentPattern?.oscDetectable) {
        tracked.tracker.onNotification(n.body ?? "");
      }
    }
    lastOscLen = notifications.length;
  });
  cleanups.push(unsubOsc);

  function findTrackedByPaneId(paneId: string): TrackedSurface | undefined {
    for (const t of trackedSurfaces.values()) {
      if (t.paneId === paneId) return t;
    }
    return undefined;
  }

  _current = {
    destroy() {
      for (const tracked of trackedSurfaces.values()) {
        if (tracked.detachTimer !== null) {
          clearTimeout(tracked.detachTimer);
          tracked.detachTimer = null;
        }
        if (tracked.agentId) detachAgent(tracked);
        if (tracked.unsubscribeOutput) tracked.unsubscribeOutput();
        // Clear any pending heartbeat timers.
        if (tracked.paneId) clearHeartbeat(tracked.paneId);
      }
      trackedSurfaces.clear();
      // Clear all remaining heartbeat timers (paranoia sweep).
      for (const timer of heartbeatTimers.values()) clearTimeout(timer);
      heartbeatTimers.clear();
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      sweepAgentRegistry();
    },
  };
}

/** Stop the service. Tears down observers and clears the registry. */
export function destroyAgentDetection(): void {
  if (_current) {
    _current.destroy();
    _current = null;
  } else {
    // Still sweep — destroyAgentDetection is called from test hooks and
    // during app shutdown with no live _current. Ensures the registry
    // is clean even if the service wasn't active.
    sweepAgentRegistry();
  }
  _registry.reset();
  resetPaneStores();
}

/** For tests only — reset module-level state between cases. */
export function resetAgentDetectionForTests(): void {
  destroyAgentDetection();
  // The OSC store is module-level in osc-notification-service and is now
  // fed by every observer chunk; clear it so notifications from a prior
  // test don't re-fire when the next initAgentDetection runs.
  resetOscNotificationStoreForTests();
}
