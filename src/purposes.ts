/** The most bytes a purpose's detail may take in UTF-8: 64 KiB. */
export const MaxPurposeDetailBytes = 65536;

/** Carriage return, line feed, next line, line separator and paragraph separator: each ends a line in some reader. */
const LineBreak = /[\r\n\u0085\u2028\u2029]/u;

/** The JSON of a purpose a caller sets: the body of `PUT .../purpose` and the content of `purpose.json` in the archive of `compose up`. */
export interface PurposeBody {
	readonly title: string;
	/** Left out when the purpose has no detail. */
	readonly detail?: string;
}

/**
 * Checks a purpose a caller sets and gives its JSON. The service checks the other limits: a title of 1 to 200 characters.
 *
 * @param title - What the fleet or machine is being used for, in one line.
 * @param detail - Markdown notes, or undefined for none.
 * @returns The purpose's JSON; an undefined detail is left out of it.
 * @throws Error when the title has a line break or the detail takes more than 65536 bytes in UTF-8. Nothing is sent then.
 */
export function purposeBody(title: string, detail: string | undefined): PurposeBody {
	if (LineBreak.test(title)) {
		throw new Error("A purpose's title is one line; the title given has a line break.");
	}

	if (detail !== undefined && Buffer.byteLength(detail, "utf8") > MaxPurposeDetailBytes) {
		throw new Error(`A purpose's detail takes at most ${String(MaxPurposeDetailBytes)} bytes in UTF-8.`);
	}

	return detail === undefined ? { title } : { title, detail };
}
