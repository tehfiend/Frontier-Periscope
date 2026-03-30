# Plan: Log Reader / Tailer Fixes
**Status:** Draft
**Created:** 2026-03-30
**Module:** periscope

## Overview

The log file reader (`useLogWatcher.ts`) has several reliability bugs that cause data loss, missed events, and poor observability. These issues were identified by comparing the implementation against live log reading best practices.

The most critical bug is the lack of partial line buffering -- when a `file.slice()` returns text ending mid-line, the offset advances to `file.size` but the partial line is silently dropped because the regex won't match it. The remainder of the line arrives in the next poll but is never seen because reading starts past it. This means real game events can be permanently lost during active play.

Secondary issues include incorrect truncation handling (file rotation goes undetected), a slow 5s poll interval that creates noticeable lag for real-time combat/mining stats, UTF-16 split-character hazards for chat logs, no diagnostic logging, and fragile newline handling.

## Current State

The log tailing system lives in three files:

- **`apps/periscope/src/hooks/useLogWatcher.ts`** -- The main polling hook. Uses `setInterval` at 5000ms (line 15). Stores byte offsets in IndexedDB via `db.logOffsets`. Two processing functions:
  - `processGameLog()` (lines 134-199) -- reads new bytes from game log files (UTF-8), parses entries, stores events
  - `processChatLog()` (lines 202-241) -- reads new bytes from chat log files (UTF-16LE), parses entries, stores events
- **`apps/periscope/src/lib/logParser.ts`** -- Pure parsing functions. `parseEntries()` (line 82) splits on `\n` and matches each line against `ENTRY_RE` regex. `parseChatEntries()` (line 221) does the same for chat. `decodeChatLog()` (line 215) decodes UTF-16LE buffers.
- **`apps/periscope/src/lib/logFileAccess.ts`** -- File System Access API wrappers for directory handle storage and permission verification.

### Current offset tracking (useLogWatcher.ts)

1. Read stored offset: `const lastOffset = offset?.byteOffset ?? 0;` (line 141)
2. Skip if no new data: `if (file.size <= lastOffset) return null;` (line 143)
3. Read new bytes: `const blob = file.slice(lastOffset);` (line 145)
4. Advance offset to end: `await db.logOffsets.put({ ..., byteOffset: file.size, ... });` (lines 192-196)

### Known bugs

1. **Partial line loss (line 145-196):** `file.slice(lastOffset)` may return text ending mid-line. `parseEntries()` won't match the incomplete line (regex requires full `[ timestamp ] (type) message` format). Offset advances to `file.size`, so the rest of that line is never read.

2. **Wrong truncation check (line 143):** `if (file.size <= lastOffset) return null` -- when `file.size < lastOffset` (file was truncated/rotated), this silently returns null. All new content is invisible until the file grows past the old high-water mark.

3. **5s poll interval (line 15):** `POLL_INTERVAL = 5000` creates noticeable lag for real-time combat DPS and mining rate displays. Best practice for game telemetry is 250-750ms.

4. **UTF-16 byte-split hazard (line 214-216 in logParser.ts, line 215 in processChatLog):** Chat logs are UTF-16LE (2 bytes per code unit). `file.slice(lastOffset)` could yield an odd byte count if the file was written mid-character, producing garbled text from `TextDecoder("utf-16le")`.

5. **No diagnostic logging:** No visibility into file opens, truncation resets, encoding issues, or error states. The only logging is `console.error("[LogWatcher] Poll error:", err)` at line 327.

6. **No `\r\n` handling (logParser.ts line 85, 225):** `text.split("\n")` leaves trailing `\r` on each line. While current regexes may tolerate this (the `\r` appears after the matched content), it's fragile -- any regex that anchors to end-of-line (`$`) or checks exact string equality would break.

## Target State

After this plan is implemented:

1. **No partial line loss:** A `pendingLine` buffer (per file) persists between polls. Text from `file.slice()` is prepended with the pending buffer and only complete lines (terminated by `\n`) are parsed. The last unterminated segment is saved as the new pending buffer. Offset advances only to the byte position of the last complete line.

2. **Correct truncation handling:** When `file.size < lastOffset`, offset resets to 0 and the pending buffer is cleared. A diagnostic log is emitted.

3. **Configurable poll interval:** Default reduced to 1000ms. A constant that can be easily adjusted (and potentially exposed as a user setting in the future).

4. **UTF-16 safe reads:** For chat log files, byte reads are aligned to 2-byte boundaries. If `file.size - lastOffset` is odd, the last byte is excluded from the current read (it will be included in the next poll when the write completes).

5. **Diagnostic logging:** Console log messages for key state transitions: file first open, truncation detected (with old/new size), encoding issues, poll errors, and periodic summary stats.

6. **Robust line splitting:** `parseEntries()` and `parseChatEntries()` normalize `\r\n` -> `\n` before splitting, eliminating trailing `\r` from all lines.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pending buffer storage | Module-level `Map<string, string>` in useLogWatcher.ts | Must survive between polls but not between page loads. IndexedDB would add latency and complexity for transient state. Map keyed by fileName. |
| Offset advancement | Advance to last-complete-line byte position | Prevents partial line loss. Calculate bytes consumed using `new TextEncoder().encode(completedText).byteLength` for UTF-8 game logs. |
| UTF-16 byte alignment | Round down to even byte count before slicing | Simple, zero-cost guard. The excluded odd byte will be read on next poll when the game client finishes writing the character. |
| Poll interval default | 1000ms | Balances responsiveness (combat/mining updates) with CPU/IO cost. 250ms is aggressive for a browser tab; 1s is a good compromise. |
| `\r\n` normalization | In parser functions, not in the hook | Keep parsing logic self-contained. The hook passes raw text; parsers normalize before splitting. |
| Diagnostic log format | `[LogWatcher]` and `[LogParser]` prefixed console.log/warn | Consistent with existing `[LogWatcher]` error pattern at line 327. No external logging dependency needed. |
| Pending buffer for chat logs | Same Map, keyed by `chat:${fileName}` | Chat logs need the same partial-line protection. Key prefix matches existing offset key pattern (line 209). |

## Implementation Phases

### Phase 1: Partial line buffering and offset fix

This phase fixes the two data-loss bugs (partial lines and truncation).

1. Add a module-level `pendingLines` Map at the top of `useLogWatcher.ts`:
   ```ts
   const pendingLines = new Map<string, string>();
   ```

2. In `processGameLog()`, after reading the blob text (line 146):
   - Prepend any pending buffer: `const fullText = (pendingLines.get(fileName) ?? "") + text;`
   - Find the last newline index in `fullText`
   - If no newline found, store entire `fullText` as pending, return null (no complete lines yet)
   - Split into `completedText` (up to and including last newline) and `remainder` (after last newline)
   - Store `remainder` in `pendingLines` (or delete key if empty)
   - Pass `completedText` to `parseHeader()` and `parseEntries()` instead of `text`
   - Calculate bytes consumed: `new TextEncoder().encode(completedText).byteLength`
   - Update offset to `lastOffset + bytesConsumed` instead of `file.size`

3. In `processGameLog()`, fix truncation handling before the size check:
   - Change `if (file.size <= lastOffset) return null;` to:
     ```ts
     if (file.size < lastOffset) {
       // File was truncated or rotated -- reset
       console.warn(`[LogWatcher] File truncated: ${fileName} (${lastOffset} -> ${file.size})`);
       await db.logOffsets.put({ fileName, byteOffset: 0, lastModified: file.lastModified });
       pendingLines.delete(fileName);
       return processGameLog(fileName, fileHandle); // re-enter with offset 0
     }
     if (file.size === lastOffset) return null;
     ```

4. Apply the same partial-line buffering pattern to `processChatLog()`:
   - Use key `chat:${fileName}` for `pendingLines` (matches offset key pattern)
   - Same logic: prepend pending, split at last newline, store remainder
   - For byte offset calculation, use `remainder.length * 2` subtracted from file.size (UTF-16LE = 2 bytes per code unit), but see Phase 3 for the proper UTF-16 alignment

5. In `processChatLog()`, fix truncation handling:
   - Same pattern as game logs: reset offset to 0 when `file.size < lastOffset`

### Phase 2: Line ending normalization

1. In `logParser.ts`, update `parseEntries()` (line 82):
   - Add `text = text.replace(/\r\n/g, "\n");` as the first line of the function body

2. In `logParser.ts`, update `parseHeader()` (line 63):
   - Add the same `\r\n` normalization

3. In `logParser.ts`, update `parseChatEntries()` (line 221):
   - Add the same `\r\n` normalization

### Phase 3: UTF-16 byte alignment

1. In `processChatLog()`, after calculating the read range, ensure even byte count:
   ```ts
   let readEnd = file.size;
   const bytesToRead = readEnd - lastOffset;
   if (bytesToRead % 2 !== 0) {
     readEnd = lastOffset + bytesToRead - 1; // exclude trailing odd byte
   }
   if (readEnd <= lastOffset) return 0;
   const blob = file.slice(lastOffset, readEnd);
   ```

2. Update the offset storage to use `readEnd` (the actual bytes read) rather than `file.size`

3. Adjust the pending buffer byte calculation to account for UTF-16LE encoding:
   - When calculating bytes consumed from completed text, multiply character count by 2
   - Final offset = `lastOffset + (completedText.length * 2)`

### Phase 4: Poll interval and diagnostics

1. Change `POLL_INTERVAL` from `5000` to `1000` at line 15

2. Add diagnostic logging to `processGameLog()`:
   - On first read (lastOffset === 0): `console.log("[LogWatcher] Opened: ${fileName} (${file.size} bytes)")`
   - On truncation reset: already added in Phase 1
   - On new events: `console.log("[LogWatcher] ${fileName}: +${events.length} events (${lastOffset} -> ${newOffset})")`

3. Add diagnostic logging to `processChatLog()`:
   - On first read: `console.log("[LogWatcher] Chat opened: ${fileName} (${file.size} bytes)")`
   - On truncation reset: `console.warn("[LogWatcher] Chat truncated: ${fileName}")`

4. Add a periodic summary in `pollLogs()`:
   - Every 30 polls (~30s at 1s interval), log: `"[LogWatcher] Watching ${gameFiles.length} game logs, ${chatFileCount} chat logs"`

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/hooks/useLogWatcher.ts` | Modify | Add pending line buffer, fix truncation, UTF-16 alignment, poll interval, diagnostics |
| `apps/periscope/src/lib/logParser.ts` | Modify | Add `\r\n` normalization to parseEntries, parseHeader, parseChatEntries |

## Open Questions

1. **Should the poll interval be user-configurable?**
   - **Option A:** Hardcoded constant (1000ms). Pros: Simple, no UI work. Cons: Can't tune for low-power devices.
   - **Option B:** Stored in `db.settings` with UI control in the Logs view. Pros: User can tune. Cons: More UI work, edge cases (what if user sets 50ms?).
   - **Recommendation:** Option A for this plan. The constant is easy to change later. If users report performance issues, add configurability in a future plan.

2. **Should pending buffers persist across page reloads (IndexedDB) or be ephemeral (module-level Map)?**
   - **Option A:** Module-level Map (ephemeral). Pros: Simple, fast, no DB schema change. Cons: On reload, any pending partial line is lost (but offset will re-read from stored position, so re-processing that chunk recovers it).
   - **Option B:** Store in `db.logOffsets` as a new `pendingLine` field. Pros: Survives reload. Cons: Schema migration, extra DB write per poll per file, complexity.
   - **Recommendation:** Option A. Since offset is stored as the last-complete-line position (not file.size), a reload will re-read from that position and recover the partial line naturally. No data loss either way.

3. **Should diagnostic logging use `console.log` or a structured logger?**
   - **Option A:** Plain `console.log`/`console.warn` with `[LogWatcher]` prefix. Pros: Zero dependencies, matches existing pattern. Cons: No log levels, no filtering.
   - **Option B:** Create a lightweight `createLogger("LogWatcher")` utility with configurable levels. Pros: Can be silenced in production. Cons: More code, over-engineering for this scope.
   - **Recommendation:** Option A. The existing codebase uses plain console with prefixes consistently. A structured logger can be introduced project-wide later if needed.

## Deferred

- **User-configurable poll interval UI** -- Premature until we know if 1s default causes issues for anyone. Revisit if performance complaints arise.
- **File watcher API (FileSystemObserver)** -- The File System Access API may eventually support push-based change notifications, eliminating polling entirely. Not available in current browsers.
- **Multi-tab coordination** -- The singleton guard (`activePollerCount`) prevents duplicate pollers within a tab but not across tabs. Dexie-based locking could solve this but adds complexity. Not a reported issue.
- **Backpressure handling** -- If the game writes faster than we can parse/store, the pending buffer could grow unbounded. Unlikely with game log volumes but worth monitoring.
