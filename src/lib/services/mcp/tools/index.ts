/**
 * Tool registration barrel. Importing this module imports every tool module
 * for its side effects, populating the registry. The order mirrors the
 * original single-file registration order so `tools/list` output is stable.
 */
import "./sessions";
import "./interaction";
import "./orchestration";
import "./ui-writes";
import "./introspection";
import "./filesystem";
