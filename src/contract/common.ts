/**
 * A time as the API writes it: RFC 3339 in UTC with seven fractional digits, such as `2026-10-05T14:03:22.1234567Z`.
 *
 * Times stay strings because a JavaScript `Date` keeps only milliseconds, and the API identifies a process by its exact start time:
 * a `started` value read from one answer is sent back unchanged in later requests.
 */
export type Timestamp = string;

/** The JSON form of one refusal or one failed operation. */
export interface ApiError {
	/** One of the API's error codes, such as `NOT_FOUND`, `TIMEOUT` or `BUILD_FAILED`. */
	readonly code: string;
	/** What was expected and what was found, in one or two sentences. */
	readonly message: string;
	/** The field at fault: a request member, a Compose path or a recipe position; null when no one field is at fault. */
	readonly fieldPath?: string | null;
	/** The code's own data, such as `candidates` for an ambiguous prefix; null when the code carries none. */
	readonly details?: Readonly<Record<string, unknown>> | null;
}

/** A rectangle on the screen or in a window, in pixels. */
export interface WindowBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/**
 * The filters of a list route, as `endia ps -f` and the other list commands take them: each key with every value given for it,
 * such as `{ label: ["team=qa"], status: ["running"] }`.
 */
export type Filters = Readonly<Record<string, readonly string[]>>;
