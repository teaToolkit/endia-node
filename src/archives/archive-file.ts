import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { create } from "tar";
import type { RequestBody } from "../transport/api-connection.js";
import { MediaTypes } from "../routes.js";

/** One entry of an archive: the file, folder or link on disk, and the name the entry takes in the archive. */
export interface ArchiveEntry {
	/** The full path on disk. A link is archived as a link, never as what it points at. */
	readonly source: string;
	/** The name in the archive, with `/` separators; a folder's name ends in `/`. */
	readonly name: string;
}

/** The prefix of the temporary folder that holds an archive while it is sent. */
const TemporaryFolderPrefix = "eastindia-client-";

/** The file name of the archive inside its temporary folder. */
const ArchiveFileName = "archive.tar";

/**
 * A tar archive written to a temporary file, so that a request that is sent again after a failed connection sends the same bytes.
 * The archive belongs to the caller that wrote it, which deletes it with `delete` once the request has been answered.
 */
export class ArchiveFile {
	private readonly folder: string;

	/** The archive's full path. */
	readonly path: string;

	/** The archive's size in bytes. */
	readonly size: number;

	private constructor(folder: string, size: number) {
		this.folder = folder;
		this.path = path.join(folder, ArchiveFileName);
		this.size = size;
	}

	/**
	 * Writes an archive of the given entries, in the given order, in the POSIX pax format with UTF-8 names.
	 *
	 * @param entries - The entries. A folder entry holds only itself; each file under it needs its own entry.
	 * @param texts - Files that exist only in memory, such as a resolved Compose model, each written under its name.
	 * @param followLinks - Whether a link is written as what it points at, rather than as a link.
	 * @returns The archive.
	 */
	static async write(entries: readonly ArchiveEntry[], texts: readonly { name: string; text: string }[] = [], followLinks = false): Promise<ArchiveFile> {
		const folder = await mkdtemp(path.join(tmpdir(), TemporaryFolderPrefix));
		try {
			// The texts are written beside the archive and added like any other file, under their own names.
			const written = await Promise.all(texts.map(async (entry, index) => {
				const source = path.join(folder, `text-${String(index)}`);
				await writeFile(source, entry.text, "utf8");
				return { source, name: entry.name };
			}));
			const all = [...written, ...entries];
			const names = new Map(all.map((entry) => [path.resolve(entry.source), entry.name]));
			await create(
				{
					file: path.join(folder, ArchiveFileName),
					preservePaths: true,
					noDirRecurse: true,
					follow: followLinks,
					// Each entry is read from its full path and renamed to its name in the archive.
					onWriteEntry: (entry) => {
						entry.path = names.get(entry.absolute) ?? entry.path;
					},
				},
				all.map((entry) => entry.source),
			);
			const size = (await stat(path.join(folder, ArchiveFileName))).size;
			return new ArchiveFile(folder, size);
		}
		catch (error) {
			await rm(folder, { recursive: true, force: true });
			throw error;
		}
	}

	/** The archive as a request body, opened afresh for each attempt. */
	get body(): RequestBody {
		return { contentType: MediaTypes.tar, open: () => createReadStream(this.path), length: this.size };
	}

	/** Deletes the archive and its temporary folder. */
	async delete(): Promise<void> {
		await rm(this.folder, { recursive: true, force: true });
	}
}
