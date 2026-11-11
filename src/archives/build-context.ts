import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ArchiveFile, type ArchiveEntry } from "./archive-file.js";
import { DockerIgnore, EndiaIgnoreFileName, IgnoreFileName } from "./docker-ignore.js";

/** EastIndia's name for a recipe, which a build that names none reads first. */
const Endiafile = "Endiafile";

/** Docker's name for a recipe, which a build that names none reads when the context holds no `Endiafile`. */
const Dockerfile = "Dockerfile";

/** The name prefix of a recipe that lies outside the context folder, which Docker adds at the archive's root under a random name. */
const OutsideRecipePrefix = ".dockerfile.";

/** The number of random bytes in that name; each byte gives two hexadecimal digits, so the name ends in 16 digits. */
const OutsideRecipeRandomBytes = 8;

/** The archive of a build context, and the recipe's path inside it, which the build request names as `dockerfile`. */
export interface PackedContext {
	readonly archive: ArchiveFile;
	readonly recipe: string;
}

/**
 * Packs a build context folder as `endia build` sends it: a tar archive of every file, folder and link in the folder that the
 * ignore file does not exclude. A link is archived as a link, never as what it points at. The recipe and the ignore file are always
 * sent.
 *
 * The ignore file is chosen as `ignoreFileFor` chooses it. A recipe outside the folder is added at the archive's root as
 * `.dockerfile.` followed by 16 random hexadecimal digits, as Docker adds it, with its own ignore file beside it under that name
 * followed by `.endiaignore` or `.dockerignore`, as the file on disk is named.
 *
 * @param folder - The context folder.
 * @param recipe - The recipe's path, inside the folder or outside it; when undefined, `Endiafile` in the folder when it exists,
 * and `Dockerfile` otherwise.
 * @returns The archive and the recipe's path inside it; the caller deletes the archive.
 * @throws Error when the folder does not exist, when a recipe outside the folder does not exist, or when the ignore file holds a
 * malformed pattern.
 */
export async function packBuildContext(folder: string, recipe?: string): Promise<PackedContext> {
	const root = path.resolve(folder);
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		throw new Error(`The build context '${folder}' is not a folder.`);
	}

	const recipePath = path.resolve(root, recipe ?? defaultRecipe(root));
	const inside = pathInside(root, recipePath);
	if (inside === undefined && !existsSync(recipePath)) {
		throw new Error(`The recipe '${recipePath}' does not exist.`);
	}

	const ignoreFile = ignoreFileFor(root, recipePath);
	const entries = await contextEntries(root, inside, ignoreFile);
	const recipeName = inside ?? OutsideRecipePrefix + randomBytes(OutsideRecipeRandomBytes).toString("hex");
	if (inside === undefined) {
		entries.push({ source: recipePath, name: recipeName });
		// Only a recipe's own ignore file lies outside the folder; the root one is already among the entries.
		if (pathInside(root, ignoreFile) === undefined) {
			entries.push({ source: ignoreFile, name: recipeName + ignoreFile.slice(recipePath.length) });
		}
	}

	return { archive: await ArchiveFile.write(entries), recipe: recipeName };
}

/**
 * Lists the entries of a context folder that a build sends, each folder followed by what it holds, in ordinal order of name within
 * each folder. `compose up` sends each service's build context with the same entries.
 *
 * @param root - The context folder's full path.
 * @param recipe - The recipe's path inside the folder, with `/` separators, or undefined when it lies outside.
 * @param ignoreFile - The ignore file's full path, which may not exist.
 * @returns Each entry's full path and its path inside the folder; a folder's path ends in `/`.
 */
export async function contextEntries(root: string, recipe: string | undefined, ignoreFile: string): Promise<ArchiveEntry[]> {
	const ignore = existsSync(ignoreFile) ? DockerIgnore.parse(await readFile(ignoreFile, "utf8"), ignoreFile) : DockerIgnore.empty;
	const alwaysSent = new Set([recipe, pathInside(root, ignoreFile)].filter((name) => name !== undefined));
	const entries: ArchiveEntry[] = [];
	await collectEntries(root, "", ignore, alwaysSent, entries);
	return entries;
}

/**
 * Gives the recipe of a build that names none, as the `endia` CLI chooses it: `Endiafile` at the root of the context folder when it
 * exists, and `Dockerfile` otherwise.
 *
 * @param root - The context folder's full path.
 * @returns The recipe's file name.
 */
export function defaultRecipe(root: string): string {
	return isFile(path.join(root, Endiafile)) ? Endiafile : Dockerfile;
}

/**
 * Gives the ignore file that applies to a recipe, as the `endia` CLI chooses it: the first of these that exists. A recipe's own
 * ignore file is named as the recipe's file name followed by the ignore file's name, beside the recipe.
 *
 * 1. The recipe's own `.endiaignore`.
 * 2. The recipe's own `.dockerignore`.
 * 3. `.endiaignore` at the root of the folder.
 * 4. `.dockerignore` at the root of the folder.
 *
 * @param root - The context folder's full path.
 * @param recipe - The recipe's full path.
 * @returns The ignore file's full path; `.dockerignore` at the root, which does not exist, when none of the four exists.
 */
export function ignoreFileFor(root: string, recipe: string): string {
	const candidates = [recipe + EndiaIgnoreFileName, recipe + IgnoreFileName, path.join(root, EndiaIgnoreFileName), path.join(root, IgnoreFileName)];
	return candidates.find(isFile) ?? path.join(root, IgnoreFileName);
}

function isFile(file: string): boolean {
	return existsSync(file) && statSync(file).isFile();
}

/**
 * Gives a path's place inside a folder.
 *
 * @param root - The folder's full path.
 * @param target - A full path.
 * @returns The path inside the folder with `/` separators, or undefined when it lies outside the folder.
 */
export function pathInside(root: string, target: string): string | undefined {
	const relative = path.relative(root, target).split(path.sep).join("/");
	return relative === ".." || relative.startsWith("../") || path.isAbsolute(relative) ? undefined : relative;
}

// Lists a folder's entries and, for each sub-folder that needs it, the sub-folder's entries. A sub-folder the ignore file leaves out
// is still listed when the recipe or the ignore file lies under it, or when the ignore file has a `!` line, which could re-include a
// file under it; Docker's own walk does the same. A link is never followed.
async function collectEntries(folder: string, prefix: string, ignore: DockerIgnore, alwaysSent: ReadonlySet<string>, entries: ArchiveEntry[]): Promise<void> {
	const names = (await readdir(folder)).sort(compareOrdinal);
	for (const name of names) {
		const relative = prefix + name;
		const source = path.join(folder, name);
		const item = await lstat(source);
		const sent = alwaysSent.has(relative) || !ignore.isIgnored(relative);
		const walked = item.isDirectory() && (sent || ignore.reincludes || [...alwaysSent].some((kept) => kept.startsWith(`${relative}/`)));
		if (sent) {
			entries.push({ source, name: item.isDirectory() ? `${relative}/` : relative });
		}

		if (walked) {
			await collectEntries(source, `${relative}/`, ignore, alwaysSent, entries);
		}
	}
}

// Ordinal order compares UTF-16 code units, as the CLI orders names, rather than the locale's order.
function compareOrdinal(first: string, second: string): number {
	return first < second ? -1 : first > second ? 1 : 0;
}
