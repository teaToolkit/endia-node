import type { Timestamp } from "./common.js";

/** The answer to `endia system df`, as `docker system df` answers: what the images, machines, named volumes and build cache hold on disk, which of it is in use and which `system prune` would delete, and how much room the image folder's volume has left. */
export interface DiskUsage {
	/** Every image. */
	readonly images: readonly ImageUsage[];
	/** Every machine. */
	readonly machines: readonly MachineUsage[];
	/** Every named volume. */
	readonly volumes: readonly VolumeUsage[];
	/** Every build-cache entry. A service older than multi-stage builds leaves it out. */
	readonly buildCache?: readonly BuildCacheUsage[];
	/** The image folder's volume: its free space, its capacity and the space EastIndia keeps free on it. */
	readonly imageFolder: ImageFolderSpace;
	/** The storage root: what its records take and the free space on its volume. */
	readonly storageRoot: StorageRootSpace;
}

/** One image as `system df` counts it. */
export interface ImageUsage {
	/** The image's digest. */
	readonly id: string;
	/** The tags that name the image; empty for an image without tags. */
	readonly repoTags: readonly string[];
	/** The digest of the image this image is built on, or null for an imported image, which has no parent. */
	readonly parentId: string | null;
	/** When the image was recorded. */
	readonly created: Timestamp;
	/** The size on disk of the image's own disk file, without its parents'. */
	readonly sizeBytes: number;
	/** The number of machines made from the image. */
	readonly machines: number;
	/** The number of images built on the image. */
	readonly children: number;
	/** Whether `system prune --all` would delete the image: no machine that a prune keeps uses it, nor is any image built on it. */
	readonly reclaimable: boolean;
}

/** One machine as `system df` counts it: its writable disk, which holds what the machine changed since it was made from its image. */
export interface MachineUsage {
	/** The machine name. */
	readonly name: string;
	/** The machine's state; `system prune` deletes the machines in state `exited` or `created`. */
	readonly state: string;
	/** The size on disk of the machine's writable disk file; 0 when the file does not exist. */
	readonly sizeBytes: number;
}

/** One named volume as `system df` counts it. */
export interface VolumeUsage {
	/** The volume name. */
	readonly name: string;
	/** The size on disk of the volume's disk file; 0 when the file does not exist. */
	readonly sizeBytes: number;
	/** The machine the volume is attached to, or null. */
	readonly attachedTo: string | null;
}

/** One build-cache entry as `system df` counts it: the committed result of a recipe's stage that a build made below its target. It is not an image; a later build whose stage has the same build key reuses it. */
export interface BuildCacheUsage {
	/** The entry's digest. */
	readonly id: string;
	/** The digest of the image or build-cache entry the entry is built on. */
	readonly parentId: string | null;
	/** When a build made the entry. */
	readonly created: Timestamp;
	/** When a build last made or found the entry. */
	readonly lastUsed: Timestamp;
	/** The size on disk of the entry's own disk file. */
	readonly sizeBytes: number;
	/** Whether an image, machine or other entry is built on the entry, or a running build has made or found it. `system df` counts such entries as active. */
	readonly inUse: boolean;
	/** Whether `builder prune` would delete the entry. */
	readonly reclaimable: boolean;
}

/** The room left on the image folder's volume, where every disk lives. */
export interface ImageFolderSpace {
	/** The image folder's full path. */
	readonly path: string;
	/** The free space on its volume. */
	readonly freeBytes: number;
	/** The capacity of its volume. */
	readonly capacityBytes: number;
	/** The space EastIndia keeps free on the volume: `minFreeDiskGiB`; a disk that would leave less is refused. */
	readonly reserveBytes: number;
}

/** What the storage root takes and the room left on its volume. */
export interface StorageRootSpace {
	/** The storage root's full path. */
	readonly path: string;
	/** The size of the files under the storage root, leaving out the image folder when it lies there, whose disks the other rows count. */
	readonly sizeBytes: number;
	/** The free space on its volume. */
	readonly freeBytes: number;
}

/** The result of a `system prune` operation: what it deleted and the space that freed. */
export interface PruneResult {
	/** The stopped machines deleted, by name; the next `compose up` of their fleets creates them again. */
	readonly deletedMachines: readonly string[];
	/** The images deleted, by digest. */
	readonly deletedImages: readonly string[];
	/** The build-cache entries deleted, by digest: the results of recipe stages below a build's target that nothing used. A service older than multi-stage builds leaves it out. */
	readonly deletedBuildCache?: readonly string[];
	/** The named volumes deleted, by name. */
	readonly deletedVolumes: readonly string[];
	/** The number of finished operations deleted, those older than `operationRetentionDays`. */
	readonly deletedOperations: number;
	/** The owned objects deleted whose owner no longer existed, each as its kind and name. */
	readonly deletedOrphans: readonly string[];
	/** The size of the files deleted. */
	readonly reclaimedBytes: number;
}

/** The result of a `builder prune` operation: the build-cache entries it deleted and the space that freed. */
export interface BuilderPruneResult {
	/** The build-cache entries deleted, by digest, in the order deleted. */
	readonly deletedBuildCache: readonly string[];
	/** The size of the disk files deleted. */
	readonly reclaimedBytes: number;
}
