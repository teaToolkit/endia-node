import type { Timestamp } from "./common.js";

/** One image in the list that `endia images` prints. Members that Docker's API also gives an image in its list, such as `id`, `repoTags` and `parentId`, carry Docker's names, so that a `--format` template written for Docker reads the same fields. */
export interface ImageSummary {
	/** The image's digest, `sha256:` and 64 hexadecimal digits, which is its ID. */
	readonly id: string;
	/** Every tag that names the image, in full `name:tag` form, sorted; empty for an image without tags. */
	readonly repoTags: readonly string[];
	/** The digest of the image this one is built on; null for an imported image, which has no parent. */
	readonly parentId: string | null;
	/** When the image was recorded. */
	readonly created: Timestamp;
	/** The size in bytes of the image's own disk file, not counting the disks of the images it is built on. */
	readonly size: number;
	/** The image's labels, by name. */
	readonly labels: Readonly<Record<string, string>>;
	/** The start, at midnight UTC, of the day on which the image's evaluation edition of Windows expires; null when the image is not an evaluation edition. */
	readonly evaluationExpires: Timestamp | null;
	/** Whether the expiry date is fewer than `evaluationWarningDays` days away or has passed, so that the image needs a warning. */
	readonly expiryWarning: boolean;
	/** The number of machines made from the image. */
	readonly machines: number;
	/** The number of images built on the image. */
	readonly children: number;
}

/** Everything that `endia image inspect` shows about one image: its tags, the chain of parents it is built on, its configuration and labels, its disk, the recipe and arguments that built it, and the machines and images that depend on it. Members that Docker's image inspect also gives, such as `id`, `repoTags`, `os` and `config`, carry Docker's names, so that a `--format` template written for Docker, such as `{{.Id}}`, reads the same fields. */
export interface ImageDetail {
	/** The image's digest, `sha256:` and 64 hexadecimal digits, which is its ID. */
	readonly id: string;
	/** Every tag that names the image, in full `name:tag` form, sorted; empty for an image without tags. */
	readonly repoTags: readonly string[];
	/** The digest of the image this one is built on; null for an imported image, which has no parent. */
	readonly parentId: string | null;
	/** When the image was recorded. */
	readonly created: Timestamp;
	/** The operating system that machines made from the image run: always `windows`. */
	readonly os: string;
	/** The processor architecture, as Docker names it: always `amd64`. */
	readonly architecture: string;
	/** The size in bytes of the image's own disk file, not counting the disks of the images it is built on. */
	readonly size: number;
	/** The configuration that machines made from the image, and images built on it, inherit; null when the image's record holds no configuration, which is the case only for a record written before image records kept it. */
	readonly config: ImageConfigDetail | null;
	/** The image's labels, by name. */
	readonly labels: Readonly<Record<string, string>>;
	/** The digests of the images this one is built on: its parent first, then the parent's parent, up to the imported image. Empty for an imported image. */
	readonly chain: readonly string[];
	/** The image's disk file: where it is, and how it came to be in the image folder. */
	readonly disk: ImageDiskDetail;
	/** The build key, a SHA-256 hash of everything that decided the build's result; null for an imported image. */
	readonly buildKey: string | null;
	/** The recipe and build arguments that built the image; null for an imported image. */
	readonly build: ImageBuildDetail | null;
	/** The names of the machines made from the image, sorted. */
	readonly machines: readonly string[];
	/** The digests of the images whose parent is this image. */
	readonly children: readonly string[];
}

/** The configuration of an image as `endia image inspect` shows it: what a machine made from the image, and an image built on it, inherit from its recipe and its parents' recipes. */
export interface ImageConfigDetail {
	/** The environment variables, each written `NAME=value`, ordered by name. */
	readonly env: readonly string[];
	/** The default arguments, or null when none are set since the last entry point. */
	readonly cmd: readonly string[] | null;
	/** The entry point, or null when none is set. */
	readonly entrypoint: readonly string[] | null;
	/** The working directory with `/` separators, such as `C:/app`, or empty when none is set. */
	readonly workingDir: string;
	/** The account programs run as, or empty when none is set. */
	readonly user: string;
	/** The exposed ports, each written `number/protocol` such as `8080/tcp`. */
	readonly exposedPorts: readonly string[];
	/** The shell that runs shell-form commands, the executable first, or empty when none is set. */
	readonly shell: readonly string[];
}

/** An image's disk file as `endia image inspect` shows it: its path, and how it came to be in the image folder. */
export interface ImageDiskDetail {
	/** The full path of the disk file in the image folder. */
	readonly path: string;
	/** How the disk file came to be in the image folder: `built` when a build made it, or, for an imported image, `copied`, `moved` or `inPlace`, the last when the file was already in the image folder and was used where it was. Null for an imported image whose record was written before image records kept how the disk came in. */
	readonly broughtIn: string | null;
}

/** What built an image, as `endia image inspect` shows it: the recipe's text and the build arguments it was built with. */
export interface ImageBuildDetail {
	/** The text of the recipe. */
	readonly recipe: string;
	/** The build arguments, by name. */
	readonly buildArgs: Readonly<Record<string, string>>;
}

/** The answer to `endia tag`: the tag that was set, the image it names now and the image it named before. */
export interface TagResult {
	/** The tag that was set, the `TARGET_IMAGE[:TAG]` argument of `endia tag`. */
	readonly target: string;
	/** The digest of the image that the tag now names. */
	readonly digest: string;
	/** The digest of the image that the tag named before; null when the tag is new. */
	readonly previousDigest: string | null;
}

/** One event of `endia rmi`, as `docker rmi` answers: a tag that was removed, written `{ "untagged": tag }`, or an image that was deleted, written `{ "deleted": digest }`. The answer lists the events in the order they happened, so the removal of an image's last tag comes before the deletion it led to. */
export interface RemovalEntry {
	/** The tag that was removed, in the form `name:tag`, or null when the event is a deletion. */
	readonly untagged?: string | null;
	/** The digest of the image that was deleted, or null when the event is a removed tag. */
	readonly deleted?: string | null;
}

/** The result of a finished build: the image it made or reused for its target stage, the tags that now name that image, whether anything was built, and what each stage on the way to the target gave. */
export interface BuildResult {
	/** The digest of the image, in the form `sha256:` followed by 64 hexadecimal digits. */
	readonly digest: string;
	/** The tags that were requested, each of which now names the image; empty when the build asked for none. */
	readonly tags: readonly string[];
	/** The target stage's build key: a SHA-256 hash of everything that decides its result. A later build with the same key reuses this image. */
	readonly buildKey: string;
	/** Whether every stage was found in the cache, so that nothing was built. */
	readonly cacheHit: boolean;
	/** How long the build took, in seconds, from the start of the operation's work to the last tag moved. */
	readonly seconds: number;
	/** Each stage the build made or found, from the lowest, built on an image, to the target. A recipe of one stage gives one. A service older than multi-stage builds leaves it out. */
	readonly stages?: readonly BuildStageResult[];
}

/** What one stage of a build gave: the image, for the target stage, or a build-cache entry, for a stage below it. A stage is the part of a recipe from one `FROM` to the next; a build-cache entry is a stage's committed result that is not an image, which a later build whose stage has the same build key reuses. */
export interface BuildStageResult {
	/** The name that the stage's `FROM ... AS` gives it, in lower case, or null for a stage without one. */
	readonly name: string | null;
	/** The digest of the stage's result, in the form `sha256:` followed by 64 hexadecimal digits. */
	readonly digest: string;
	/** The stage's build key: a SHA-256 hash of everything that decides the stage's result. */
	readonly buildKey: string;
	/** Whether an image or build-cache entry with the stage's build key already existed, so that the stage was not built. */
	readonly cacheHit: boolean;
}
