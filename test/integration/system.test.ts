import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { HostStats } from "../../src/contract/stats.js";
import type { SystemInfo, VersionInfo } from "../../src/contract/status.js";
import type { EastIndiaClient } from "../../src/eastindia-client.js";
import { FakeService } from "../support/fake-service.js";

// Answers recorded from service 0.16.88, with only the host's name replaced. Each is checked with `satisfies` when the tests compile,
// so a member the service sends and the type lacks, or a member the type requires and the service no longer sends, fails the build.

const recordedInfo = {
	name: "LAB-HOST",
	serverVersion: "0.16.88",
	operatingSystem: "Microsoft Windows 11 Pro",
	osVersion: "10.0.26200",
	architecture: "x86_64",
	logicalProcessors: 24,
	memoryTotalBytes: 67813310464,
	storageRoot: "C:\\ProgramData\\EastIndia",
	imageFolder: "M:\\EastIndia",
	machines: 2,
	machinesRunning: 1,
	machinesExited: 1,
	images: 14,
	fleets: 2,
	volumes: 0,
	hyperV: {
		ready: true,
		reason: null,
		internetSwitch: "Default Switch",
		internetSwitchPresent: true,
	},
	config: {
		imageFolder: "M:\\EastIndia",
		listenAddress: "127.0.0.1",
		listenPort: 7443,
		resourcePrefix: "eastindia-",
		internetSwitch: "Default Switch",
		hostReserveMiB: 12288,
		minFreeDiskGiB: 20,
		builderMemoryMiB: 2048,
		builderProcessorCount: 2,
		basePrepareDiskGiB: 64,
		basePrepareTimeoutSeconds: 3600,
		guestProgramsFolder: null,
		machineMemoryMiB: 2048,
		machineMemoryFloorMiB: 512,
		machineMemoryCeilingMiB: 4096,
		machineProcessorCount: 2,
		maxLayerDepth: 8,
		buildCacheKeepGiB: 20,
		maxParallelBoots: 2,
		guestConnectTimeoutSeconds: 2,
		guestReadyTimeoutSeconds: 600,
		desktopReadyTimeoutSeconds: 180,
		setupTimeoutSeconds: 1800,
		stopTimeoutSeconds: 120,
		buildStepTimeoutSeconds: 1800,
		restartTimeoutSeconds: 600,
		desktopActionTimeoutSeconds: 60,
		uacSettleSeconds: 5,
		restartDelayInitialMilliseconds: 100,
		restartDelayMaxSeconds: 60,
		restartResetAfterSeconds: 10,
		defaultAddressPools: null,
		volumeSizeGiB: 64,
		machineLogMaxBytes: 10485760,
		statsIntervalSeconds: 1,
		operationRetentionDays: 7,
		idempotencyRetentionHours: 24,
		purposeHistoryMaxEntries: 500,
		serviceLogRetentionDays: 30,
		retentionSweepMinutes: 60,
		maxContextBytes: 21474836480,
		clientCertificateValidityDays: 365,
		evaluationWarningDays: 14,
		hyperVRequestTimeoutSeconds: 60,
		hyperVJobTimeoutSeconds: 600,
		turnOffTimeoutSeconds: 300,
		sshReadyTimeoutSeconds: 20,
		statsReadTimeoutSeconds: 10,
	},
	warnings: [],
} satisfies SystemInfo;

const recordedVersion = {
	version: "0.16.88",
	apiVersion: "1",
	gitCommit: "5dff5f3",
	built: "2026-11-11T22:54:35.0000000Z",
	os: "windows",
	arch: "amd64",
	guestServiceVersion: "0.16.88",
} satisfies VersionInfo;

const recordedHostStats = {
	read: "2026-11-13T08:58:33.2822951Z",
	logicalProcessors: 24,
	cpuPercent: 6.447404314383669,
	memoryTotalBytes: 67813310464,
	memoryAvailableBytes: 14545326080,
	memoryReserveBytes: 12884901888,
	machinesMemoryBytes: 2147483648,
	diskBytesPerSecond: 91526818.69639885,
	networkBytesPerSecond: 56420.059582919566,
	unavailable: [],
} satisfies HostStats;

describe("the service's description", () => {
	let service: FakeService;
	let client: EastIndiaClient;

	beforeEach(async () => {
		service = await FakeService.overHttps();
		client = service.client();
	});

	afterEach(async () => {
		client.close();
		await service.close();
	});

	it("reads the info answer of service 0.16.88, which no longer carries the retired Hyper-V access keys", async () => {
		service.json("GET", "/v1/info", 200, recordedInfo);

		const info = await client.info();

		assert.deepEqual(info, recordedInfo);
		assert.equal(info.config.buildCacheKeepGiB, 20);
		assert.equal(info.config.purposeHistoryMaxEntries, 500);
	});

	it("reads the version answer of service 0.16.88", async () => {
		service.json("GET", "/v1/version", 200, recordedVersion);

		assert.deepEqual(await client.version(), recordedVersion);
	});

	it("reads the host's disk and network rates from a host reading", async () => {
		service.json("GET", "/v1/host/stats", 200, recordedHostStats);

		const readings: HostStats[] = [];
		for await (const reading of client.stats.host({ stream: false })) {
			readings.push(reading);
		}

		assert.deepEqual(readings, [recordedHostStats]);
		assert.equal(readings[0]?.diskBytesPerSecond, recordedHostStats.diskBytesPerSecond);
	});
});
