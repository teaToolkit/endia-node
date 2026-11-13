import type { Timestamp } from "./common.js";

/** The service's version, as `endia version` prints it. */
export interface VersionInfo {
	readonly version: string;
	readonly apiVersion: string;
	readonly gitCommit: string;
	readonly built: Timestamp;
	readonly os: string;
	readonly arch: string;
	/** The version of the guest service the service installs in new machines, or null when it has none. */
	readonly guestServiceVersion?: string | null;
}

/** The host's description, the configuration in effect and what needs attention, as `endia info` prints them. */
export interface SystemInfo {
	readonly name: string;
	readonly serverVersion: string;
	readonly operatingSystem: string;
	readonly osVersion: string;
	readonly architecture: string;
	readonly logicalProcessors: number;
	readonly memoryTotalBytes: number;
	readonly storageRoot: string;
	readonly imageFolder: string;
	readonly machines: number;
	readonly machinesRunning: number;
	readonly machinesExited: number;
	readonly images: number;
	readonly fleets: number;
	readonly volumes: number;
	readonly hyperV: HyperVStatus;
	/** The service's configuration in effect. */
	readonly config: HostConfigurationView;
	readonly warnings: readonly string[];
}

/** Whether Hyper-V can run machines, and the switch that gives them the internet. */
export interface HyperVStatus {
	readonly ready: boolean;
	readonly reason?: string | null;
	readonly internetSwitch: string;
	readonly internetSwitchPresent: boolean;
}

/** The host's configuration as `endia info` answers it: each key of `config\policy.json` with the value in effect, under the key's camel-case name. The service fills it from its configuration, and the members, their order and their nullability are the wire. This type holds no logic and no defaults, so every member is required. */
export interface HostConfigurationView {
	/** The `imageFolder` key in effect: the absolute path of the image folder, or null when it is not set. */
	readonly imageFolder: string | null;
	/** The `listenAddress` key in effect. */
	readonly listenAddress: string;
	/** The `listenPort` key in effect. */
	readonly listenPort: number;
	/** The `resourcePrefix` key in effect. */
	readonly resourcePrefix: string;
	/** The `internetSwitch` key in effect. */
	readonly internetSwitch: string;
	/** The `hostReserveMiB` key in effect. */
	readonly hostReserveMiB: number;
	/** The `minFreeDiskGiB` key in effect. */
	readonly minFreeDiskGiB: number;
	/** The `builderMemoryMiB` key in effect. */
	readonly builderMemoryMiB: number;
	/** The `builderProcessorCount` key in effect. */
	readonly builderProcessorCount: number;
	/** The `basePrepareDiskGiB` key in effect. */
	readonly basePrepareDiskGiB: number;
	/** The `basePrepareTimeoutSeconds` key in effect. */
	readonly basePrepareTimeoutSeconds: number;
	/** The `guestProgramsFolder` key in effect, or null when it is not set. */
	readonly guestProgramsFolder: string | null;
	/** The `machineMemoryMiB` key in effect. */
	readonly machineMemoryMiB: number;
	/** The `machineMemoryFloorMiB` key in effect. */
	readonly machineMemoryFloorMiB: number;
	/** The `machineMemoryCeilingMiB` key in effect. */
	readonly machineMemoryCeilingMiB: number;
	/** The `machineProcessorCount` key in effect. */
	readonly machineProcessorCount: number;
	/** The `maxLayerDepth` key in effect. */
	readonly maxLayerDepth: number;
	/** The `buildCacheKeepGiB` key in effect. */
	readonly buildCacheKeepGiB: number;
	/** The `maxParallelBoots` key in effect. */
	readonly maxParallelBoots: number;
	/** The `guestConnectTimeoutSeconds` key in effect. */
	readonly guestConnectTimeoutSeconds: number;
	/** The `guestReadyTimeoutSeconds` key in effect. */
	readonly guestReadyTimeoutSeconds: number;
	/** The `desktopReadyTimeoutSeconds` key in effect. */
	readonly desktopReadyTimeoutSeconds: number;
	/** The `setupTimeoutSeconds` key in effect. */
	readonly setupTimeoutSeconds: number;
	/** The `stopTimeoutSeconds` key in effect. */
	readonly stopTimeoutSeconds: number;
	/** The `buildStepTimeoutSeconds` key in effect. */
	readonly buildStepTimeoutSeconds: number;
	/** The `restartTimeoutSeconds` key in effect. */
	readonly restartTimeoutSeconds: number;
	/** The `desktopActionTimeoutSeconds` key in effect. */
	readonly desktopActionTimeoutSeconds: number;
	/** The `uacSettleSeconds` key in effect. */
	readonly uacSettleSeconds: number;
	/** The `restartDelayInitialMilliseconds` key in effect. */
	readonly restartDelayInitialMilliseconds: number;
	/** The `restartDelayMaxSeconds` key in effect. */
	readonly restartDelayMaxSeconds: number;
	/** The `restartResetAfterSeconds` key in effect. */
	readonly restartResetAfterSeconds: number;
	/** The `defaultAddressPools` key in effect, or null when it is not set. */
	readonly defaultAddressPools: readonly AddressPoolView[] | null;
	/** The `volumeSizeGiB` key in effect. */
	readonly volumeSizeGiB: number;
	/** The `machineLogMaxBytes` key in effect. */
	readonly machineLogMaxBytes: number;
	/** The `statsIntervalSeconds` key in effect. */
	readonly statsIntervalSeconds: number;
	/** The `operationRetentionDays` key in effect. */
	readonly operationRetentionDays: number;
	/** The `idempotencyRetentionHours` key in effect. */
	readonly idempotencyRetentionHours: number;
	/** The `purposeHistoryMaxEntries` key in effect. */
	readonly purposeHistoryMaxEntries: number;
	/** The `serviceLogRetentionDays` key in effect. */
	readonly serviceLogRetentionDays: number;
	/** The `retentionSweepMinutes` key in effect. */
	readonly retentionSweepMinutes: number;
	/** The `maxContextBytes` key in effect. */
	readonly maxContextBytes: number;
	/** The `clientCertificateValidityDays` key in effect. */
	readonly clientCertificateValidityDays: number;
	/** The `evaluationWarningDays` key in effect. */
	readonly evaluationWarningDays: number;
	/** The `hyperVRequestTimeoutSeconds` key in effect. */
	readonly hyperVRequestTimeoutSeconds: number;
	/** The `hyperVJobTimeoutSeconds` key in effect. */
	readonly hyperVJobTimeoutSeconds: number;
	/** The `turnOffTimeoutSeconds` key in effect. */
	readonly turnOffTimeoutSeconds: number;
	/** The `sshReadyTimeoutSeconds` key in effect. */
	readonly sshReadyTimeoutSeconds: number;
	/** The `statsReadTimeoutSeconds` key in effect. */
	readonly statsReadTimeoutSeconds: number;
}

/** One entry of the `defaultAddressPools` key as `HostConfigurationView` writes it: a range of IPv4 addresses and the prefix length of the subnets cut from it. */
export interface AddressPoolView {
	/** The range in CIDR form, for example `10.231.0.0/16`. */
	readonly base: string;
	/** The prefix length of each subnet cut from the range, for example `24`. */
	readonly size: number;
}
