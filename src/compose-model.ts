import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ComposeModel } from "./contract/compose.js";

/** Which Compose project to resolve, as the options of `endia compose` choose it. */
export interface ComposeProjectOptions {
	/** The Compose files, in order; when undefined, the CLI finds them as `docker compose` does, from the working folder. */
	readonly files?: readonly string[];
	/** The Compose project's name; the service names the fleet after it. */
	readonly projectName?: string;
	/** The folder against which relative paths are resolved; the first file's folder when undefined. */
	readonly projectDirectory?: string;
	/** Files of variables whose values the CLI fills into the Compose files; `.env` in the project folder when undefined. */
	readonly envFiles?: readonly string[];
	/** The working folder of the CLI. When `files` is undefined, the CLI looks for Compose files in this folder and its parents. */
	readonly cwd?: string;
	/** The `endia` program; `endia` on the `PATH` when undefined. */
	readonly cli?: string;
}

/** The resolved model, both as the object the client reads and as the exact JSON text the CLI printed. */
export interface ResolvedComposeModel {
	readonly model: ComposeModel;
	readonly text: string;
}

const run = promisify(execFile);

/** The most output read from the CLI, far more than any resolved model needs; Node's default of 1 MiB could cut a large model short. */
const MaxModelBytes = 64 * 1024 * 1024;

/**
 * Resolves a Compose project with the `endia` CLI, for `FleetsClient.up` to send. The client does not read Compose files itself.
 * The CLI reads the files, merges them, fills in their variables and checks them by the rules the service applies. It then prints
 * the resolved model, with every path absolute, as `endia compose config --format json`. A caller without the CLI can write the
 * resolved model itself.
 *
 * @param options - The files, the project name and folder, and the variable files.
 * @returns The resolved model.
 * @throws Error with the CLI's own message when the project is not valid or the CLI cannot be run.
 */
export async function resolveComposeModel(options: ComposeProjectOptions = {}): Promise<ResolvedComposeModel> {
	const args = ["compose"];
	for (const file of options.files ?? []) {
		args.push("--file", file);
	}

	if (options.projectName !== undefined) {
		args.push("--project-name", options.projectName);
	}

	if (options.projectDirectory !== undefined) {
		args.push("--project-directory", options.projectDirectory);
	}

	for (const file of options.envFiles ?? []) {
		args.push("--env-file", file);
	}

	args.push("config", "--format", "json");
	try {
		const { stdout } = await run(options.cli ?? "endia", args, { cwd: options.cwd, maxBuffer: MaxModelBytes, encoding: "utf8" });
		return { model: JSON.parse(stdout) as ComposeModel, text: stdout };
	}
	catch (error) {
		const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr).trim() : "";
		throw new Error(`endia compose config failed${stderr === "" ? "" : `: ${stderr}`}`, { cause: error });
	}
}
