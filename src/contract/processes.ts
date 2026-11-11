import type { Timestamp, WindowBounds } from "./common.js";

/** One process running in a machine, as `endia process ls` lists it, as `docker top` lists a container's processes. */
export interface ProcessSummary {
	/** The process ID. */
	readonly processId: number;
	/** The ID of the process that started it; that process may have ended since. */
	readonly parentProcessId: number;
	/** The Windows session it runs in: 0 for the background session, greater than 0 for the desktop user's. */
	readonly sessionId: number;
	/** The account it runs as, as `DOMAIN\name`, or null when Windows does not say. */
	readonly user: string | null;
	/** When it started, which `--started` takes to name it safely, or null when Windows does not say. */
	readonly started: Timestamp | null;
	/** The program's file name, for example `notepad.exe`. */
	readonly name: string;
}

/** One process in full, as `endia process inspect` prints it: what it runs, as whom, whether it still runs, and its windows. A process that has ended is known only when EastIndia started it on the machine's current boot, and then only what EastIndia recorded when it started it: a member that is no longer known is null. */
export interface ProcessDetail {
	/** The process ID. */
	readonly processId: number;
	/** The ID of the process that started it, or null when it is not known. */
	readonly parentProcessId: number | null;
	/** The program's file name, or null when it is not known. */
	readonly name: string | null;
	/** The program's full path, or null when it is not known. */
	readonly executablePath: string | null;
	/** The command line, or null when it is not known. */
	readonly commandLine: string | null;
	/** When it started; `--started` takes this value to name the process safely. */
	readonly started: Timestamp;
	/** The Windows session it runs in: 0 for the background session, greater than 0 for the desktop user's. */
	readonly sessionId: number;
	/** The account it runs as, as `DOMAIN\name`, or null when it is not known. */
	readonly user: string | null;
	/** The integrity level of its token: `low`, `medium`, `high` or `system`; null when it is not known. */
	readonly integrityLevel: string | null;
	/** Whether it still runs. */
	readonly running: boolean;
	/** Its exit code once it has ended, when EastIndia started it on the current boot; otherwise null. */
	readonly exitCode: number | null;
	/** Its top-level windows; empty in the background session and once it has ended. */
	readonly windows: readonly ProcessWindow[];
}

/** One top-level window of a process on the desktop user's screen. */
export interface ProcessWindow {
	/** The window handle as hexadecimal text, for example `0x2a0b4c`, which `desktop inspect --window` takes. */
	readonly handle: string;
	/** The title bar text; empty when the window has none. */
	readonly title: string;
	/** The window class name. */
	readonly className: string;
	/** Whether the window is shown. */
	readonly visible: boolean;
	/** Where the window is, in physical pixels from the top-left corner of the screen. */
	readonly bounds: WindowBounds;
}

/** The answer to `endia process wait` once the process has ended, as `docker wait` answers. */
export interface ProcessWaitResult {
	/** The process's exit code, or null when Windows could not give it, as for a protected process. */
	readonly exitCode: number | null;
}

/** The answer to `endia process stop`: how the process ended and its exit code. */
export interface ProcessStopResult {
	/** The process's exit code, or null when Windows could not give it. */
	readonly exitCode: number | null;
	/** How it ended: `closed`, `ended` or `alreadyExited`. */
	readonly how: string;
}

/** One line of what a process started by `endia exec -d` wrote, as `process logs` streams it, one JSON object per line of `application/x-ndjson`. */
export interface ProcessLogLine {
	/** The output the line came from: `stdout` or `stderr`. */
	readonly stream: string;
	/** The text of the line, without its line ending. */
	readonly line: string;
}
