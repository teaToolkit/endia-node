import { existsSync, statSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ArchiveFile, type ArchiveEntry } from "./archive-file.js";
import { contextEntries, defaultRecipe, ignoreFileFor, pathInside } from "./build-context.js";
import type { ComposeModel, ComposeService } from "../contract/compose.js";
import type { PurposeBody } from "../purposes.js";

/** The name of the resolved model in the archive. */
const ModelEntry = "compose.json";

/** The name of the purpose the caller sets as the fleet comes up, in the archive. */
const PurposeEntry = "purpose.json";

/** The folder of the archive that holds each built service's context, as `contexts/<service>/`. */
const ContextsFolder = "contexts";

/** The folder of the archive that holds each bind mount's source, as `binds/<service>/<index of the volume entry>`. */
const BindsFolder = "binds";

/** The type of a volume entry whose source is a file or folder on the caller's side. */
const BindType = "bind";

/**
 * Writes the body of `compose up`, as the `endia` CLI writes it: one tar archive holding what the service needs from the caller's
 * side, because a caller in a sandbox shares no folder with the host.
 *
 * - `compose.json` is the resolved model.
 * - `contexts/<service>/` holds the build context of each selected service that has `build`, with the files a build would send.
 * - `binds/<service>/<index>` holds the source of each bind mount of every service, by the index of its entry in the service's
 *   `volumes`, counted from 0: a folder with everything under it, or a file.
 * - `purpose.json` is the purpose's title and detail, present only when the caller sets the fleet's purpose as it comes up; the
 *   service stores it before any other work.
 *
 * @param model - The resolved model.
 * @param modelText - The model's JSON text, sent as `compose.json` exactly as the caller gave it.
 * @param services - The services named for `compose up`; none selects every service. The selection adds the services they depend on.
 * @param purpose - The fleet's purpose to set as it comes up, as `purposeBody` gives it; undefined leaves the fleet's purpose as it is.
 * @returns The archive; the caller deletes it.
 * @throws Error when a built service's context is not a folder or its recipe lies outside it, or when a bind mount's source does not
 * exist. Nothing is sent then.
 */
export async function packFleet(model: ComposeModel, modelText: string, services: readonly string[], purpose?: PurposeBody): Promise<ArchiveFile> {
	const selected = selectServices(model, services);
	const entries: ArchiveEntry[] = [];
	for (const [name, service] of Object.entries(model.services)) {
		if (service.build && selected.has(name)) {
			entries.push(...await builtContextEntries(name, service.build));
		}

		for (const [index, volume] of (service.volumes ?? []).entries()) {
			if (volume.type === BindType && volume.source !== undefined) {
				entries.push(...await bindEntries(name, index, volume.source));
			}
		}
	}

	const texts = [{ name: ModelEntry, text: modelText }];
	if (purpose !== undefined) {
		texts.push({ name: PurposeEntry, text: JSON.stringify(purpose) });
	}

	return ArchiveFile.write(entries, texts, true);
}

/**
 * Gives the selected services: those named with every service they depend on, directly or through another, or every service when
 * none is named.
 *
 * @param model - The resolved model.
 * @param named - The services named.
 * @returns The selected services' names.
 * @throws Error when a named service is not in the model.
 */
export function selectServices(model: ComposeModel, named: readonly string[]): ReadonlySet<string> {
	if (named.length === 0) {
		return new Set(Object.keys(model.services));
	}

	const selected = new Set<string>();
	const pending = [...named];
	for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
		const service = model.services[name];
		if (service === undefined) {
			throw new Error(`The Compose model has no service "${name}".`);
		}

		if (!selected.has(name)) {
			selected.add(name);
			pending.push(...dependenciesOf(service));
		}
	}

	return selected;
}

function dependenciesOf(service: ComposeService): string[] {
	const dependsOn = service.depends_on ?? [];
	return Array.isArray(dependsOn) ? [...(dependsOn as readonly string[])] : Object.keys(dependsOn);
}

// A context's files are named under contexts/<service>/; its folders are not sent, only the root's own entry. The service accepts
// only files and folders in this archive, so a link in the context is sent as what it points at: a link to a file as that file,
// and a link to a folder as an empty folder.
async function builtContextEntries(service: string, build: NonNullable<ComposeService["build"]>): Promise<ArchiveEntry[]> {
	const context = build.context;
	if (context === undefined) {
		throw new Error(`Service "${service}" has a build without a context.`);
	}

	if (!existsSync(context) || !statSync(context).isDirectory()) {
		throw new Error(`The build context '${context}' of service "${service}" is not a folder.`);
	}

	const recipe = path.resolve(context, build.dockerfile ?? defaultRecipe(path.resolve(context)));
	const inside = pathInside(context, recipe);
	if (inside === undefined) {
		throw new Error(`The recipe '${recipe}' of service "${service}" must be inside its build context '${context}'.`);
	}

	const root = `${ContextsFolder}/${service}/`;
	const files = (await contextEntries(path.resolve(context), inside, ignoreFileFor(path.resolve(context), recipe))).filter((entry) => !entry.name.endsWith("/"));
	return [{ source: context, name: root }, ...files.map((entry) => ({ source: entry.source, name: root + entry.name }))];
}

async function bindEntries(service: string, index: number, source: string): Promise<ArchiveEntry[]> {
	const root = `${BindsFolder}/${service}/${String(index)}`;
	const item = await stat(source).catch(() => undefined);
	if (item === undefined) {
		throw new Error(`The bind mount source '${source}' of service "${service}" does not exist.`);
	}

	if (!item.isDirectory()) {
		return [{ source, name: root }];
	}

	const entries: ArchiveEntry[] = [{ source, name: `${root}/` }];
	await collectEverything(source, `${root}/`, entries, new Set([await realpath(source)]));
	return entries;
}

// Every folder and file under a folder, each folder before what it holds. A link is followed to what it points at, because the
// service accepts only files and folders in this archive; a link back to a folder already being walked is refused.
async function collectEverything(folder: string, prefix: string, entries: ArchiveEntry[], walking: ReadonlySet<string>): Promise<void> {
	for (const name of (await readdir(folder)).sort()) {
		const source = path.join(folder, name);
		if (!(await stat(source)).isDirectory()) {
			entries.push({ source, name: prefix + name });
			continue;
		}

		const real = await realpath(source);
		if (walking.has(real)) {
			throw new Error(`The folder '${source}' leads back to a folder that holds it.`);
		}

		entries.push({ source, name: `${prefix}${name}/` });
		await collectEverything(source, `${prefix}${name}/`, entries, new Set([...walking, real]));
	}
}
