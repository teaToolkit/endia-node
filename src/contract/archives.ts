import type { Timestamp } from "./common.js";

/** What a path in a machine is, as the archive routes describe it in their `X-EastIndia-Path-Stat` header, Docker's `X-Docker-Container-Path-Stat`: its name, size, kind, time of last change and, for a link, what it points at. `endia cp` decides where a copy lands from it. */
export interface PathStat {
	/** The path's last name. */
	readonly name: string;
	/** A file's size in bytes; 0 for a folder or a link. */
	readonly size: number;
	/** What the path is: `file`, `directory` or `link`. */
	readonly mode: string;
	/** When the path last changed. */
	readonly mtime: Timestamp;
	/** What a link points at, as the link holds it; null for a file or a folder. */
	readonly linkTarget: string | null;
}
