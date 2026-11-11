import type { Timestamp } from "./common.js";

/** One named volume as `endia volume ls` and `endia volume inspect` show it: its disk, its size, the fleet that created it and the machine it is attached to. */
export interface VolumeDetail {
	/** The volume's name. */
	readonly name: string;
	/** The driver, always `local`. */
	readonly driver: string;
	/** The full path of the volume's disk on the host. */
	readonly mountpoint: string;
	/** The volume's labels from the Compose model. */
	readonly labels: Readonly<Record<string, string>>;
	/** The most bytes the disk may grow to. */
	readonly sizeBytes: number;
	/** The size of the disk's file now, in bytes, or null when the file cannot be read. */
	readonly usedBytes: number | null;
	/** The name of the fleet whose `compose up` created the volume. */
	readonly fleet: string;
	/** The name of the machine the volume is attached to, or null when it is attached to none. */
	readonly attachedTo: string | null;
	/** When the volume was created. */
	readonly created: Timestamp;
}
