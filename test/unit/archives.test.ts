import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { list } from "tar";
import { packBuildContext } from "../../src/archives/build-context.js";
import { packFleet, selectServices } from "../../src/archives/fleet-archive.js";
import type { ComposeModel } from "../../src/contract/compose.js";

/** Lists an archive's entries in order, each as `<type> <name>`, followed by `-> <target>` for a symbolic link. */
async function entriesOf(file: string): Promise<string[]> {
	const entries: string[] = [];
	await list({
		file,
		onReadEntry: (entry) => {
			entries.push(`${entry.type} ${entry.path}${entry.type === "SymbolicLink" ? ` -> ${entry.linkpath ?? ""}` : ""}`);
		},
	});
	return entries;
}

/** Writes files under a folder, each given by its path inside the folder and its text; a path ending in `/` makes a folder. */
function writeTree(root: string, files: Readonly<Record<string, string>>): void {
	for (const [name, text] of Object.entries(files)) {
		const full = path.join(root, name);
		if (name.endsWith("/")) {
			mkdirSync(full, { recursive: true });
		}
		else {
			mkdirSync(path.dirname(full), { recursive: true });
			writeFileSync(full, text);
		}
	}
}

describe("archives", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), "eastindia-client-archive-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	// Examples of use

	it("packBuildContext_FolderWithIgnoreFile_SendsWhatTheIgnoreFileKeepsInOrdinalOrderAndLinksAsLinks", async () => {
		const context = path.join(root, "ledger");
		writeTree(context, {
			"Dockerfile": "FROM eastindia/development:latest\nCOPY publish/ C:/ledger/\n",
			".dockerignore": "**/obj\nlogs\n!logs/sample.log\n*.user\n",
			"publish/Ledger.exe": "MZ",
			"publish/obj/project.assets.json": "{}",
			"logs/2026-10-05.log": "today",
			"logs/sample.log": "sample",
			"Ledger.csproj.user": "<Project />",
			"Zeta.txt": "upper case sorts before lower case",
		});
		symlinkSync("publish/Ledger.exe", path.join(context, "latest.exe"));

		const packed = await packBuildContext(context);
		try {
			assert.equal(packed.recipe, "Dockerfile");
			assert.deepEqual(await entriesOf(packed.archive.path), [
				"File .dockerignore",
				"File Dockerfile",
				"File Zeta.txt",
				"SymbolicLink latest.exe -> publish/Ledger.exe",
				// The folder logs is left out, but the line !logs/sample.log re-includes that file, so the walk looks inside logs.
				"File logs/sample.log",
				"Directory publish/",
				"File publish/Ledger.exe",
			]);
		}
		finally {
			await packed.archive.delete();
		}
	});

	it("packBuildContext_RecipeOutsideTheFolderWithItsOwnIgnoreFile_AddsBothAtTheRootUnderARandomName", async () => {
		const context = path.join(root, "context");
		writeTree(context, { "app.txt": "app", "secret.txt": "secret" });
		writeTree(root, { "recipes/dotnet.Dockerfile": "FROM eastindia/development:latest\n", "recipes/dotnet.Dockerfile.dockerignore": "secret.txt\n" });

		const packed = await packBuildContext(context, path.join(root, "recipes", "dotnet.Dockerfile"));
		try {
			assert.match(packed.recipe, /^\.dockerfile\.[0-9a-f]{16}$/u);
			assert.deepEqual(await entriesOf(packed.archive.path), [
				"File app.txt",
				`File ${packed.recipe}`,
				`File ${packed.recipe}.dockerignore`,
			]);
		}
		finally {
			await packed.archive.delete();
		}
	});

	// Without a named recipe the CLI reads Endiafile when the folder holds one, and the recipe's own .endiaignore comes first; with
	// Dockerfile and the root .dockerignore the entries would differ.
	it("packBuildContext_FolderWithAnEndiafileAndNoRecipeNamed_PacksAsTheCliPacksIt", async () => {
		writeTree(root, {
			"Endiafile": "FROM eastindia/development:latest\n",
			"Dockerfile": "FROM eastindia/development:latest\n",
			"Endiafile.endiaignore": "Dockerfile\nnotes.txt\n",
			"Endiafile.dockerignore": "keep.txt\n",
			".endiaignore": "keep.txt\n",
			".dockerignore": "keep.txt\n",
			"notes.txt": "left out",
			"keep.txt": "sent",
		});

		const packed = await packBuildContext(root);
		try {
			assert.equal(packed.recipe, "Endiafile");
			assert.deepEqual(await entriesOf(packed.archive.path), [
				"File .dockerignore",
				"File .endiaignore",
				"File Endiafile",
				"File Endiafile.dockerignore",
				"File Endiafile.endiaignore",
				"File keep.txt",
			]);
		}
		finally {
			await packed.archive.delete();
		}
	});

	// Each ignore file, removed in turn, gives way to the next in the CLI's order: the recipe's own .endiaignore, its own
	// .dockerignore, the root's .endiaignore and the root's .dockerignore.
	it("packBuildContext_IgnoreFilesInEachPlace_AppliesTheFirstInTheClisOrder", async () => {
		const order = ["Dockerfile.endiaignore", "Dockerfile.dockerignore", ".endiaignore", ".dockerignore"];
		writeTree(root, { "Dockerfile": "FROM eastindia/development:latest\n", ...Object.fromEntries(order.map((name) => [name, `${name}.txt\n`])) });
		for (const name of order) {
			writeFileSync(path.join(root, `${name}.txt`), "left out by this ignore file only");
		}

		const applied: string[] = [];
		for (const name of order) {
			const packed = await packBuildContext(root);
			try {
				const entries = await entriesOf(packed.archive.path);
				applied.push(order.find((candidate) => !entries.includes(`File ${candidate}.txt`)) ?? "none");
			}
			finally {
				await packed.archive.delete();
			}

			rmSync(path.join(root, name));
		}

		assert.deepEqual(applied, order);
	});

	it("packBuildContext_RecipeOutsideTheFolderWithItsOwnEndiaignore_AddsItUnderTheRandomNameWithItsOwnSuffix", async () => {
		const context = path.join(root, "context");
		writeTree(context, { "app.txt": "app", "secret.txt": "secret" });
		writeTree(root, { "recipes/dotnet.Endiafile": "FROM eastindia/development:latest\n", "recipes/dotnet.Endiafile.endiaignore": "secret.txt\n" });

		const packed = await packBuildContext(context, path.join(root, "recipes", "dotnet.Endiafile"));
		try {
			assert.deepEqual(await entriesOf(packed.archive.path), [
				"File app.txt",
				`File ${packed.recipe}`,
				`File ${packed.recipe}.endiaignore`,
			]);
		}
		finally {
			await packed.archive.delete();
		}
	});

	it("packFleet_BuildWithoutADockerfileInAFolderHoldingAnEndiafile_SendsWhatTheCliSends", async () => {
		writeTree(root, {
			"lab/Endiafile": "FROM eastindia/development:latest\n",
			"lab/Dockerfile": "FROM eastindia/development:latest\n",
			"lab/Endiafile.endiaignore": "Dockerfile\nnotes.txt\n",
			"lab/.dockerignore": "keep.txt\n",
			"lab/notes.txt": "left out",
			"lab/keep.txt": "sent",
		});
		const model: ComposeModel = { name: "shop", services: { lab: { build: { context: path.join(root, "lab") } } } };

		const archive = await packFleet(model, JSON.stringify(model), []);
		try {
			assert.deepEqual(await entriesOf(archive.path), [
				"File compose.json",
				"Directory contexts/lab/",
				"File contexts/lab/.dockerignore",
				"File contexts/lab/Endiafile",
				"File contexts/lab/Endiafile.endiaignore",
				"File contexts/lab/keep.txt",
			]);
		}
		finally {
			await archive.delete();
		}
	});

	it("packFleet_ModelWithABuildAndABindMount_HoldsTheModelTheContextFilesAndTheBindSourceWithLinksFollowed", async () => {
		writeTree(root, {
			"web/Dockerfile": "FROM eastindia/development:latest\n",
			"web/.dockerignore": "notes.md\n",
			"web/site/index.html": "<p>shop</p>",
			"web/notes.md": "left out",
			"data/seed/customers.csv": "id,name",
			"settings.json": "{}",
		});
		// The service accepts only files and folders in a fleet's archive, so these two links must arrive as the files they name.
		symlinkSync("seed/customers.csv", path.join(root, "data", "latest.csv"));
		symlinkSync("site/index.html", path.join(root, "web", "home.html"));
		const model: ComposeModel = {
			name: "shop",
			services: {
				web: {
					build: { context: path.join(root, "web"), dockerfile: "Dockerfile" },
					volumes: [
						{ type: "volume", source: "shop-data", target: "C:/data" },
						{ type: "bind", source: path.join(root, "data"), target: "C:/seed" },
					],
				},
				db: { image: "eastindia/development:latest", volumes: [{ type: "bind", source: path.join(root, "settings.json"), target: "C:/settings.json" }] },
			},
		};

		const archive = await packFleet(model, JSON.stringify(model), []);
		try {
			assert.deepEqual(await entriesOf(archive.path), [
				"File compose.json",
				// The eastindia CLI sends a build context as its root folder's entry and its files, without entries for inner folders.
				"Directory contexts/web/",
				"File contexts/web/.dockerignore",
				"File contexts/web/Dockerfile",
				"File contexts/web/home.html",
				"File contexts/web/site/index.html",
				// The bind mount is the second entry of web's volumes, so its index is 1.
				"Directory binds/web/1/",
				"File binds/web/1/latest.csv",
				"Directory binds/web/1/seed/",
				"File binds/web/1/seed/customers.csv",
				"File binds/db/0",
			]);
		}
		finally {
			await archive.delete();
		}
	});

	it("selectServices_NamedService_AddsWhatItDependsOnDirectlyAndThroughOthers", () => {
		const model: ComposeModel = {
			name: "shop",
			services: {
				web: { depends_on: { api: { condition: "service_healthy" } } },
				api: { depends_on: ["db"] },
				db: {},
				tools: {},
			},
		};
		assert.deepEqual([...selectServices(model, ["web"])].sort(), ["api", "db", "web"]);
		assert.deepEqual([...selectServices(model, [])].sort(), ["api", "db", "tools", "web"]);
	});

	// Examples of misuse

	it("packFleet_RecipeOutsideTheBuildContext_IsRefusedBeforeAnythingIsSent", async () => {
		writeTree(root, { "web/app.txt": "app", "Dockerfile": "FROM eastindia/development:latest\n" });
		const model: ComposeModel = { name: "shop", services: { web: { build: { context: path.join(root, "web"), dockerfile: "../Dockerfile" } } } };
		await assert.rejects(packFleet(model, JSON.stringify(model), []), /must be inside its build context/u);
	});

	it("packFleet_MissingBindSource_IsRefusedNamingIt", async () => {
		const model: ComposeModel = { name: "shop", services: { web: { volumes: [{ type: "bind", source: path.join(root, "absent"), target: "C:/absent" }] } } };
		await assert.rejects(packFleet(model, JSON.stringify(model), []), /bind mount source .*absent' of service "web" does not exist/u);
	});

	it("packBuildContext_MissingFolder_IsRefused", async () => {
		await assert.rejects(packBuildContext(path.join(root, "absent")), /is not a folder/u);
	});
});
