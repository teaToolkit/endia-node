import type { Timestamp } from "./common.js";

/** The body of `POST /v1/machines/{name}/exec`, which `endia exec` sends to create an exec: the program and its arguments, the account, the working folder, the extra variables, and whether the program gets a console and standard input. The exec is started by a second request. */
export interface ExecCreateRequest {
	/** The program followed by its arguments; at least the program. */
	readonly cmd: readonly string[];
	/** The local account to run as, or null to run as the service's default user, or the image's user when the service sets none. */
	readonly user?: string | null;
	/** The folder to start in, or null to start in the service's default folder, or the image's folder when the service sets none. */
	readonly workingDir?: string | null;
	/** The extra variables, each written `NAME=value`, laid over the machine's main-process environment. */
	readonly env?: readonly string[];
	/** Whether the program gets a Windows pseudo console. */
	readonly tty?: boolean;
	/** Whether the program's standard input stays open for what the caller sends. */
	readonly attachStdin?: boolean;
	/** The console's size as rows and then columns, or null for the pseudo console's default. */
	readonly consoleSize?: readonly number[] | null;
}

/** The answer to `POST /v1/machines/{name}/exec`: the new exec's ID, which the start, inspect and resize routes take. */
export interface ExecCreated {
	/** The exec ID: 32 lower-case hexadecimal digits. */
	readonly id: string;
}

/** The answer to a detached start: the process the program runs in, which the process commands take. */
export interface ExecStarted {
	/** The Windows process ID inside the machine. */
	readonly processId: number;
	/** When the process started, which tells it apart from a later process given the same ID. */
	readonly started: Timestamp;
}

/** One exec as `GET /v1/execs/{id}` shows it: what was asked for, the process it runs in, whether it still runs and, once it has ended, its exit code. `endia exec` reads the exit code here once the program's output has ended. */
export interface ExecDetail {
	/** The exec ID: 32 lower-case hexadecimal digits. */
	readonly id: string;
	/** The name of the machine the exec runs in. */
	readonly machine: string;
	/** The boot of Windows in which the exec was created or, once the exec has started, in which it started. */
	readonly bootId: string | null;
	/** The program followed by its arguments. */
	readonly cmd: readonly string[];
	/** The account asked for, or null for the default. */
	readonly user: string | null;
	/** The working folder asked for, or null for the default. */
	readonly workingDir: string | null;
	/** Whether the program has a pseudo console. */
	readonly tty: boolean;
	/** Whether the exec was started detached. */
	readonly detached: boolean;
	/** The Windows process ID inside the machine, or null before the program has started or when it could not. */
	readonly processId: number | null;
	/** When the program started, or null before it has. */
	readonly started: Timestamp | null;
	/** Whether the program runs now. */
	readonly running: boolean;
	/** The program's exit code once it has ended: 127 when the program was not found and 126 when it was found but could not start, as Docker gives them. Null while it runs, and when Windows restarted before it ended. */
	readonly exitCode: number | null;
	/** When the program ended, or null. */
	readonly exited: Timestamp | null;
	/** Why the program could not start, or null. */
	readonly startError: string | null;
}
