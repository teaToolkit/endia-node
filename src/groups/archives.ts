import type { IncomingMessage } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { create, extract } from "tar";
import type { PathStat } from "../contract/archives.js";
import { EastIndiaApiError } from "../errors.js";
import { Headers, Routes } from "../routes.js";
import { readHeaderJson, tarBody, type ApiConnection } from "../transport/api-connection.js";

/** A path in a machine read as a tar archive: its description, and the archive as it arrives. */
export interface MachineArchive {
	readonly stat: PathStat;
	/** The tar archive; the caller reads it to its end or destroys it. */
	readonly archive: IncomingMessage;
}

/** The query parameter that carries the path on the archive routes. A refusal for a missing path names it as the field at fault. */
const PathParameter = "path";

/**
 * The archive routes of `endia cp`, which copy files into and out of a running machine as tar archives. Paths in a machine are
 * absolute Windows paths, such as `C:\data` or `C:/data`; a relative path is relative to `C:\`.
 *
 * `copyIn` and `copyOut` copy between a local path and a machine folder. They place the copy inside an existing folder under the
 * source's own name, which is one of the placements `docker cp` makes. `stat`, `read`, `write` and `delete` are the single routes,
 * for a caller that applies the other placements or packs its own archives.
 */
export class ArchivesClient {
	private readonly connection: ApiConnection;

	/** @internal */
	constructor(connection: ApiConnection) {
		this.connection = connection;
	}

	/**
	 * Copies a local file or folder into a folder in the machine, under its own name. A link is copied as a link.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param source - The local file or folder.
	 * @param folder - The machine folder, which must exist.
	 * @param signal - Cancels the request.
	 * @returns When the service has written every file. When a file to be replaced is in use in the machine, the service stops the
	 * copy at that file and refuses it with `FILES_LOCKED`; the files written before it stay written.
	 */
	copyIn(machine: string, source: string, folder: string, signal?: AbortSignal): Promise<void> {
		const resolved = path.resolve(source);
		const open = (): Readable => Readable.from(create({ cwd: path.dirname(resolved), follow: false }, [path.basename(resolved)]));
		return this.write(machine, folder, open, signal);
	}

	/**
	 * Copies a file or folder out of the machine into a local folder, under its own name.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param source - The path in the machine.
	 * @param folder - The local folder, created when it does not exist.
	 * @param signal - Cancels the request.
	 * @returns The source's description. An archive entry whose path would lead outside the local folder is refused.
	 */
	async copyOut(machine: string, source: string, folder: string, signal?: AbortSignal): Promise<PathStat> {
		await mkdir(folder, { recursive: true });
		const read = await this.read(machine, source, signal);
		await pipeline(read.archive, extract({ cwd: folder }), signal === undefined ? {} : { signal });
		return read.stat;
	}

	/**
	 * Describes a path in the machine: `HEAD /v1/machines/{name}/archive`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param target - The path in the machine.
	 * @param signal - Cancels the request.
	 * @returns The path's name, size, kind and modification time; null when nothing is at the path.
	 */
	async stat(machine: string, target: string, signal?: AbortSignal): Promise<PathStat | null> {
		try {
			return statOf(await this.connection.head(Routes.machineArchive(machine, target), signal));
		}
		catch (error) {
			if (error instanceof EastIndiaApiError && error.status === 404 && error.fieldPath === PathParameter) {
				return null;
			}

			throw error;
		}
	}

	/**
	 * Reads a path in the machine as a tar archive: `GET /v1/machines/{name}/archive`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param source - The path in the machine; a folder path ending in `\.` asks for the folder's contents without the folder.
	 * @param signal - Ends the request.
	 * @returns The path's description and the archive.
	 */
	async read(machine: string, source: string, signal?: AbortSignal): Promise<MachineArchive> {
		const archive = await this.connection.openStream({ method: "GET", path: Routes.machineArchive(machine, source), signal });
		return { stat: statOf(archive.headers), archive };
	}

	/**
	 * Extracts a tar archive into a folder in the machine: `PUT /v1/machines/{name}/archive`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param folder - The machine folder, which must exist.
	 * @param archive - The archive: its bytes, or a function that opens it afresh, so that a retried request sends the same bytes.
	 * @param signal - Cancels the request.
	 * @returns When the service has written every file.
	 */
	write(machine: string, folder: string, archive: Uint8Array | (() => Readable), signal?: AbortSignal): Promise<void> {
		const body = tarBody(archive);
		return this.connection.changeWithoutAnswer({ method: "PUT", path: Routes.machineArchive(machine, folder), body, signal });
	}

	/**
	 * Deletes a file or folder in the machine: `DELETE /v1/machines/{name}/archive`.
	 *
	 * @param machine - The machine name or a unique prefix of its ID.
	 * @param target - The path in the machine.
	 * @param signal - Cancels the request.
	 * @returns When the service has deleted it.
	 */
	delete(machine: string, target: string, signal?: AbortSignal): Promise<void> {
		return this.connection.changeWithoutAnswer({ method: "DELETE", path: Routes.machineArchive(machine, target), signal });
	}
}

function statOf(headers: IncomingMessage["headers"]): PathStat {
	const stat = readHeaderJson(headers, Headers.pathStat) as PathStat | undefined;
	if (stat === undefined) {
		throw new Error(`The service answered without a readable ${Headers.pathStat} header.`);
	}

	return stat;
}
