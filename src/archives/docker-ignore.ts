/**
 * Docker's name for an ignore file. A recipe may have its own ignore file beside it, named as the recipe's file name followed by
 * this name, such as `recipes/dotnet.Dockerfile.dockerignore`.
 */
export const IgnoreFileName = ".dockerignore";

/** EastIndia's name for an ignore file, which a build reads in preference to a `.dockerignore` in the same place. */
export const EndiaIgnoreFileName = ".endiaignore";

/** The first character of a comment line. */
const CommentMarker = "#";

/** The first character of a pattern that re-includes what earlier patterns excluded. */
const ReincludeMarker = "!";

/** A leading byte-order mark, which the file may start with and which is not part of its first line. */
const ByteOrderMark = "﻿";

/** One line of an ignore file, as a regular expression over a whole context path, and whether the line re-includes what it matches. */
interface IgnorePattern {
	readonly expression: RegExp;
	readonly reincludes: boolean;
}

/**
 * A build context's ignore file: which of the context's files a build leaves out of the archive it sends, so that no `COPY` can copy
 * them and they do not change the build key. It matches paths by the same rules as the `endia` CLI, which follows Docker's
 * `.dockerignore` matching. A folder sent by this client therefore gives the same archive as the same folder sent by the CLI.
 *
 * Patterns are cleaned and anchored at the context root, and a leading `/` is dropped. `*` and `?` stop at `/`, `**` spans folders,
 * and `[...]` is a character class. A later line overrides an earlier one, and `!` re-includes. A path is ignored when the pattern
 * that decides it matches the path itself or any of its parent folders.
 */
export class DockerIgnore {
	private readonly patterns: readonly IgnorePattern[];

	private constructor(patterns: readonly IgnorePattern[]) {
		this.patterns = patterns;
	}

	/** An ignore file that excludes nothing, for a context without one. */
	static readonly empty = new DockerIgnore([]);

	/**
	 * Reads the text of an ignore file. Lines end in LF or CRLF. Blank lines and lines whose first non-blank character is `#` are
	 * skipped.
	 *
	 * @param text - The file's content.
	 * @param file - The file's path, which error messages name.
	 * @returns The ignore file.
	 * @throws Error naming the file, the line and the column of every malformed pattern.
	 */
	static parse(text: string, file: string = IgnoreFileName): DockerIgnore {
		const patterns: IgnorePattern[] = [];
		const problems: string[] = [];
		const lines = (text.startsWith(ByteOrderMark) ? text.slice(1) : text).split("\n").map((line) => line.replace(/\r$/u, ""));
		lines.forEach((raw, index) => {
			const trimmed = raw.trim();
			if (trimmed.length === 0 || trimmed.startsWith(CommentMarker)) {
				return;
			}

			const at = `${file}:${String(index + 1)}:${String(raw.length - raw.trimStart().length + 1)}`;
			const reincludes = trimmed.startsWith(ReincludeMarker);
			const body = reincludes ? trimmed.slice(1).trim() : trimmed;
			if (body.length === 0) {
				problems.push(`${at}: A '${ReincludeMarker}' needs a pattern after it.`);
				return;
			}

			// Patterns are anchored at the context root, so a leading '/' says nothing more.
			let cleaned = cleanPath(body);
			if (cleaned.length > 1 && cleaned.startsWith("/")) {
				cleaned = cleaned.slice(1);
			}

			const compiled = compilePattern(cleaned);
			if (typeof compiled === "string") {
				problems.push(`${at}: The pattern '${trimmed}' is not valid: ${compiled}.`);
			}
			else {
				patterns.push({ expression: compiled, reincludes });
			}
		});

		if (problems.length > 0) {
			throw new Error(problems.join("\n"));
		}

		return new DockerIgnore(patterns);
	}

	/**
	 * Whether any line re-includes with `!`. Only then can a path under a left-out folder be sent, so only then must a walk of the
	 * context look inside a left-out folder.
	 */
	get reincludes(): boolean {
		return this.patterns.some((pattern) => pattern.reincludes);
	}

	/**
	 * Decides whether a context path is left out. The patterns apply in file order, and the last pattern that matches decides. The
	 * context root itself is never left out.
	 *
	 * @param path - A path relative to the context root, with `/` separators.
	 * @returns True when the path, or one of its parent folders, is left out.
	 * @throws Error when the path leads outside the context.
	 */
	isIgnored(path: string): boolean {
		const cleaned = cleanPath(path).replace(/^\/+/u, "");
		if (cleaned === ".." || cleaned.startsWith("../")) {
			throw new Error(`The path '${path}' points outside the build context.`);
		}

		if (cleaned.length === 0 || cleaned === ".") {
			return false;
		}

		const parents: string[] = [];
		for (let slash = cleaned.indexOf("/"); slash >= 0; slash = cleaned.indexOf("/", slash + 1)) {
			parents.push(cleaned.slice(0, slash));
		}

		let ignored = false;
		for (const pattern of this.patterns) {
			// A re-including pattern can only undo a match, and an excluding one can only add one, so a pattern that could change nothing is skipped.
			if (pattern.reincludes !== ignored) {
				continue;
			}

			if (pattern.expression.test(cleaned) || parents.some((parent) => pattern.expression.test(parent))) {
				ignored = !pattern.reincludes;
			}
		}

		return ignored;
	}
}

/**
 * Cleans a path with `/` separators by the rules of Go's `path.Clean`, which Docker applies to ignore patterns.
 *
 * - Empty and `.` segments are dropped.
 * - A `..` removes the segment before it; at the start of a relative path it stays.
 * - An empty result is `.`.
 *
 * @param path - The path.
 * @returns The cleaned path.
 */
export function cleanPath(path: string): string {
	if (path.length === 0) {
		return ".";
	}

	const rooted = path.startsWith("/");
	const segments: string[] = [];
	for (const segment of path.split("/")) {
		if (segment.length === 0 || segment === ".") {
			continue;
		}

		if (segment === "..") {
			if (segments.length > 0 && segments[segments.length - 1] !== "..") {
				segments.pop();
			}
			else if (!rooted) {
				segments.push("..");
			}

			continue;
		}

		segments.push(segment);
	}

	const joined = segments.join("/");
	return rooted ? `/${joined}` : joined.length === 0 ? "." : joined;
}

/**
 * Translates a cleaned pattern into a regular expression over a whole context path. `*` becomes any characters other than `/`, `?`
 * becomes one such character, `**` spans folders, `[...]` is a character class, and a backslash escapes the next character.
 *
 * @returns The expression, or the reason the pattern is not valid.
 */
function compilePattern(pattern: string): RegExp | string {
	let text = "^";
	for (let index = 0; index < pattern.length;) {
		const character = pattern.charAt(index);
		if (character === "*") {
			const star = translateStar(pattern, index);
			text += star.text;
			index = star.next;
		}
		else if (character === "?") {
			text += "[^/]";
			index++;
		}
		else if (character === "[") {
			const characterClass = translateClass(pattern, index);
			if (characterClass === undefined) {
				return "a '[' has no closing ']'";
			}

			text += characterClass.text;
			index = characterClass.next;
		}
		else if (character === "\\") {
			if (index + 1 >= pattern.length) {
				return "a trailing '\\' escapes nothing";
			}

			text += escapeCharacter(pattern.charAt(index + 1));
			index += 2;
		}
		else {
			text += escapeCharacter(character);
			index++;
		}
	}

	return new RegExp(`${text}$`, "su");
}

/**
 * Translates the `*` or `**` at an index. A single `*` matches any characters other than `/`. A `**` consumes a `/` that follows it;
 * at the end of the pattern it matches anything, and elsewhere any number of whole folders, including none, so `logs/**` does not
 * match `logs` itself.
 */
function translateStar(pattern: string, index: number): { text: string; next: number } {
	if (pattern.charAt(index + 1) !== "*") {
		return { text: "[^/]*", next: index + 1 };
	}

	let next = index + 2;
	if (pattern.charAt(next) === "/") {
		next++;
	}

	return { text: next >= pattern.length ? ".*" : "(?:.*/)?", next };
}

/**
 * Translates the `[...]` class at an index. In a class, `^` first negates, a backslash escapes, `a-z` is a range, and a `]` first in
 * the class is a literal.
 *
 * @returns The translation and the index after the class, or undefined when the class has no closing `]`.
 */
function translateClass(pattern: string, index: number): { text: string; next: number } | undefined {
	let position = index + 1;
	let text = "[";
	if (pattern.charAt(position) === "^") {
		text += "^";
		position++;
	}

	let members = 0;
	while (position < pattern.length && (pattern.charAt(position) !== "]" || members === 0)) {
		let character = pattern.charAt(position);
		if (character === "\\") {
			position++;
			if (position >= pattern.length) {
				break;
			}

			character = pattern.charAt(position);
			text += /[a-zA-Z0-9]/u.test(character) ? character : escapeClassCharacter(character);
		}
		else if (character === "-" && members > 0 && position + 1 < pattern.length && pattern.charAt(position + 1) !== "]") {
			text += "-";
		}
		else {
			text += escapeClassCharacter(character);
		}

		members++;
		position++;
	}

	return position >= pattern.length ? undefined : { text: `${text}]`, next: position + 1 };
}

/**
 * The characters a regular expression gives a meaning of its own outside a class. A regular expression in Unicode mode refuses an
 * escape of any other character, so only these are escaped.
 */
const SyntaxCharacters = /[\\^$.*+?()[\]{}|/]/u;

/** The characters with a meaning of their own inside a class: the syntax characters and `-`, which writes a range. */
const ClassSyntaxCharacters = /[\\^$.*+?()[\]{}|/-]/u;

function escapeCharacter(character: string): string {
	return SyntaxCharacters.test(character) ? `\\${character}` : character;
}

function escapeClassCharacter(character: string): string {
	return ClassSyntaxCharacters.test(character) ? `\\${character}` : character;
}
