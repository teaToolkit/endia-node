import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DockerIgnore } from "../../src/archives/docker-ignore.js";

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test", "fixtures", "examples");
const byteOrderMark = "﻿";

describe("DockerIgnore", () => {
	// Examples of use. The eastindia CLI decides the same questions with its C# DockerIgnore class. These expected values are copied
	// from that class's tests in tests/Shared.EastIndiaFile.Tests/DockerIgnore, so that this client and the CLI give the same answers.

	// ledger-desktop.dockerignore lists **/bin/Debug, **/obj, *.user, .git, logs and !logs/sample.log. The *.user pattern matches at
	// the context root only, because * stops at /, and logs/sample.log is kept because the later pattern re-includes it.
	const ledgerDesktop = DockerIgnore.parse(readFileSync(path.join(examples, "ledger-desktop.dockerignore"), "utf8"));
	for (const [file, ignored] of [
		["publish/Ledger.exe", false],
		["src/Ledger/bin/Debug/net10.0/Ledger.dll", true],
		["src/Ledger/bin/Release/net10.0/Ledger.dll", false],
		["src/Ledger/obj/project.assets.json", true],
		["Ledger.csproj.user", true],
		["src/Ledger/Ledger.csproj.user", false],
		[".git/config", true],
		["logs/2026-10-05.log", true],
		["logs/sample.log", false],
	] as const) {
		it(`isIgnored_LedgerDesktopContext_${file}_${ignored ? "LeftOut" : "Sent"}`, () => {
			assert.equal(ledgerDesktop.isIgnored(file), ignored);
		});
	}

	it("parse_CommentsBlankLinesCrLfAndByteOrderMark_AreSkipped", () => {
		const ignore = DockerIgnore.parse(`${byteOrderMark}# editor files\r\n\r\n  *.user\r\n!keep.user\r\n`);
		// Had the comment line been read as a pattern, it would leave out a file named after it. Had the byte-order mark been kept,
		// the first line would not start with # and would be read as such a pattern.
		assert.equal(ignore.isIgnored("# editor files"), false);
		assert.equal(ignore.isIgnored(`${byteOrderMark}# editor files`), false);
		assert.equal(ignore.isIgnored("Ledger.csproj.user"), true);
		assert.equal(ignore.isIgnored("keep.user"), false);
	});

	it("isIgnored_ReincludeBeforeTheExcludingLine_IsOverriddenByIt", () => {
		const ignore = DockerIgnore.parse("!logs/sample.log\nlogs\n");
		assert.equal(ignore.isIgnored("logs/sample.log"), true);
	});

	it("isIgnored_PathsAreCleanedAndTheContextRootIsNeverLeftOut", () => {
		const ignore = DockerIgnore.parse("**");
		assert.equal(ignore.isIgnored("./publish/../publish//Ledger.exe"), true);
		assert.equal(ignore.isIgnored("."), false);
		assert.equal(DockerIgnore.empty.isIgnored("publish/Ledger.exe"), false);
	});

	it("isIgnored_DoubleStarBetweenFolders_MatchesNoFolderOrMany", () => {
		const ignore = DockerIgnore.parse("docs/**/draft-*.md\nlogs/**\n");
		assert.equal(ignore.isIgnored("docs/draft-1.md"), true);
		assert.equal(ignore.isIgnored("docs/a/b/draft-2.md"), true);
		assert.equal(ignore.isIgnored("docs/a/final.md"), false);
		// logs/** matches what is under logs, not the folder logs itself.
		assert.equal(ignore.isIgnored("logs"), false);
		assert.equal(ignore.isIgnored("logs/today.log"), true);
	});

	it("isIgnored_CharacterClassesAndEscapes_MatchAsDockerMatchesThem", () => {
		const ignore = DockerIgnore.parse("build-[0-9].log\nkeep-[^a].txt\nstar\\*.txt\nquestion?.txt\n");
		assert.equal(ignore.isIgnored("build-7.log"), true);
		assert.equal(ignore.isIgnored("build-x.log"), false);
		assert.equal(ignore.isIgnored("keep-b.txt"), true);
		assert.equal(ignore.isIgnored("keep-a.txt"), false);
		assert.equal(ignore.isIgnored("star*.txt"), true);
		assert.equal(ignore.isIgnored("star1.txt"), false);
		// ? stands for one character other than /.
		assert.equal(ignore.isIgnored("question1.txt"), true);
		assert.equal(ignore.isIgnored("question/.txt"), false);
	});

	// Examples of misuse

	it("parse_MalformedPatterns_AreEachReportedWithLineAndColumn", () => {
		// Only the first pattern is valid. The second has two leading spaces and an unclosed class, the third is a lone '!', and the
		// fourth is logs followed by a backslash.
		assert.throws(() => DockerIgnore.parse("**/obj\n  [abc\n!\nlogs\\\n", "context/.dockerignore"), (error: Error) => {
			assert.deepEqual(error.message.split("\n").map((line) => line.split(": ")[0]), [
				"context/.dockerignore:2:3",
				"context/.dockerignore:3:1",
				"context/.dockerignore:4:1",
			]);
			return true;
		});
	});

	it("isIgnored_PathOutsideTheContext_Throws", () => {
		assert.throws(() => DockerIgnore.empty.isIgnored("../secrets/key.pfx"), /outside the build context/u);
	});
});
