# endia

`endia` is the official Node client of the EastIndia API. EastIndia is a Windows service that runs Hyper-V Windows virtual machines, called machines, for tests. Its commands follow Docker's: an image is built from a recipe (a Dockerfile), and a Compose file describes a fleet of machines, as it describes Docker's containers. A Node program, such as a test runner, uses this package to build images, bring fleets of machines up and down, run programs in machines, copy files in and out, and drive their desktops.

Every result is a typed object, whose shape the package's TypeScript declarations give. Every failure is one of two error types: a refusal carries the API's error code, such as `NOT_FOUND`, and a connection failure says why no answer came. A program's exit code arrives in full, such as 3010.

The package is written in TypeScript and ships compiled JavaScript (ES modules) with type declarations. It needs Node 20 or later.

## How to use it

### Install

Install it from npm:

```sh
npm install endia
```

### Connect

A caller starts from `EastIndiaClient`. `fromEnv` connects as the `endia` CLI does, so a program that runs where `endia version` works needs no settings of its own:

```js
import { EastIndiaClient } from "endia";

const client = EastIndiaClient.fromEnv();
const version = await client.version();          // GET /v1/version
console.log(version.version);                    // 0.16.9
client.close();
```

`close` ends the connections the client keeps open for later requests. A context is a named connection that the `endia` CLI stores: an address and, over TCP, the three certificate files, as `endia context create` writes them. `fromEnv` chooses its connection from the first of these that is set:

1. `EASTINDIA_HOST`, with `ca.pem`, `cert.pem` and `key.pem` in the folder `EASTINDIA_CERT_PATH` names;
2. the context `EASTINDIA_CONTEXT` names;
3. `currentContext` in the CLI's `config.json`;
4. the CLI's built-in context: the named pipe `npipe:////./pipe/eastindia_engine` on Windows, and `tcp://127.0.0.1:7443` elsewhere.

The CLI keeps its contexts and `config.json` in the folder `EASTINDIA_CONFIG` names, or else in `.eastindia` in the home folder.

A program can also name the service and its certificate files itself:

```js
import { EastIndiaClient, readTlsFolder } from "endia";

const client = new EastIndiaClient({
	host: "tcp://host.docker.internal:7443",
	tls: readTlsFolder("/home/ada/.eastindia/certs"),   // { ca, cert, key } as PEM text
});

const local = new EastIndiaClient({ host: "npipe:////./pipe/eastindia_engine" });   // Windows only; no certificate
```

The constructor also takes `requestTimeoutMilliseconds`, `requestRetries` and `requestRetryDelayMilliseconds` (see Reference). Every method takes an optional `AbortSignal`, either as its last argument or as `signal` in its options.

### Build an image

`images.build` packs a context folder as `endia build` packs it, honouring its ignore file, and returns a handle on the build. The service builds in the background; `result` waits for the build to end and gives its result.

```js
const build = await client.images.build(
	{ folder: "./ledger", recipe: "./ledger/Dockerfile" },
	{ tags: ["lab/ledger:1"], buildArgs: { DOTNET_VERSION: "10.0.3" } },
);
const built = await build.result({ onLog: (text) => process.stdout.write(text) });
console.log(built.digest, built.cacheHit);

const images = await client.images.list({ reference: "lab/*" });
await client.images.tag("lab/ledger:1", "lab/ledger:approved");
await client.images.remove("lab/ledger:approved");
```

A recipe can hold several stages, each beginning with a `FROM` and named by its `AS`; a later stage can be built `FROM` an earlier one. A build makes the last stage, or the stage the `target` option names, as `endia build --target` does, and the tags name that stage's result. The stages below the target are kept as build cache: they are not images, but a later build whose stage has the same build key reuses them instead of building again. The result's `stages` lists each stage the build made or found, from the lowest to the target, with its `name`, `digest`, `buildKey` and `cacheHit`.

```dockerfile
FROM eastindia/development:latest AS tools
RUN choco install -y git

FROM tools AS app
COPY publish/ C:/app/
```

```js
await (await client.images.build({ folder: "./ledger" }, { target: "tools", tags: ["lab/tools:1"] })).result();   // builds tools alone
const app = await (await client.images.build({ folder: "./ledger" }, { tags: ["lab/app:1"] })).result();   // finds tools in the cache and builds app
console.log(app.stages);   // tools with cacheHit true, then app with cacheHit false

const pruned = await (await client.images.pruneBuildCache()).result();   // endia builder prune
console.log(pruned.deletedBuildCache, pruned.reclaimedBytes);
```

`images.pruneBuildCache` deletes the build cache that nothing uses, as `endia builder prune` does. `system.prune` deletes the same entries and lists them in `deletedBuildCache` too, and `system.diskUsage` lists every entry in `buildCache`, with its size and whether a prune would delete it.

A caller that packs its own context as an uncompressed tar archive passes `{ archive: bytes }`, or `{ archive: () => stream }`, a function that opens a Node `Readable` of the archive afresh for each attempt.

### Bring a fleet up and down

The client reads no Compose files. `fleets.up` takes the resolved model, as `endia compose config --format json` prints it, and sends it with the build contexts and bind mount sources it names. `resolveComposeModel` runs `endia` from the `PATH`, or the program its `cli` option names, to produce that model:

```js
import { resolveComposeModel } from "endia";

const { text } = await resolveComposeModel({ files: ["./compose.yaml"], projectName: "shop" });   // also gives the parsed model
const up = await client.fleets.up(text, { services: ["web"], build: "missing" });           // build: always, never or missing
const outcome = await up.result();                     // what was done to each machine, network and volume; its machines are ready
await client.fleets.wait("shop", { timeout: 900 });     // only needed for health checks: --wait and --wait-timeout

const fleet = await client.fleets.inspect("shop");     // the fleet with its machines, as endia compose ps
await (await client.fleets.down("shop", { volumes: true })).result();
```

`up.result()` comes once every machine the operation created, recreated or started is ready: Windows has booted, the machine is configured, and when its image signs a user in by itself, that user is signed in with the desktop helper running. A test can drive the desktop as soon as it has the result, with no polling of its own. `fleets.wait` then does what `endia compose up --wait` adds: it waits for health checks to pass, checks machines that were kept running as well, and throws `MachineFailedError` when a machine exits or becomes unhealthy, or a `DOMException` named `TimeoutError` when `timeout` seconds pass. `machines.inspect` gives `ready` too, with the same meaning as in `machines.list`.

**Purposes.** A purpose says what a fleet or a machine is being used for: a one-line title with optional Markdown notes, its detail. `fleets.up(model, { purpose: "Nightly UI run", purposeDetail: notes })` sets the fleet's purpose as the fleet comes up, as `endia compose up --purpose` and `--purpose-file` do; `purposeDetail` is the notes' text, not a file name, and it needs `purpose`. `fleets.purpose`, `setPurpose` and `clearPurpose` read, replace and remove a fleet's purpose, and `machines` has the same three for a machine's own purpose, which overrides its fleet's. The fleet and machine records carry `purpose`, and the machine records carry `purposeSource`, `machine` or `fleet`, where the purpose in effect comes from. A title with a line break, or a detail over 65536 bytes in UTF-8, throws before anything is sent; the service checks the rest. A purpose cannot be given with a `FleetArchive` the caller packed.

A caller without the CLI passes the resolved model as an object instead: the project `name`, and `services` by name in Compose's long syntax with every path absolute. The fleet's machines are named `<project>-<service>-<index>`, counting from 1, such as `shop-web-1`.

### Run a program

`execs.run` runs a program to its end and gives its output and its exit code in full:

```js
const result = await client.execs.run("shop-web-1", { cmd: ["cmd", "/c", "setup.cmd"] });
if (result.exitCode === 3010) {
	// the program asks for a restart
}
console.log(result.stdout, result.stderr);
```

`execs.spawn` gives the running program's `stdout` and `stderr` as readable streams and, when the request sets `attachStdin`, its `stdin` as a writable stream. Read both output streams, then call `wait` on the session for the exit code:

```js
const session = await client.execs.spawn("shop-web-1", { cmd: ["cmd", "/c", "type C:\\logs\\app.log"] });
session.stdout.pipe(process.stdout);
session.stderr.pipe(process.stderr);
const exec = await session.wait();             // exec.exitCode
```

`execs.start` starts a program detached and returns its process at once. `processes.wait` takes its `timeout` in seconds:

```js
const started = await client.execs.start("shop-web-1", { cmd: ["C:\\apps\\server.exe"] });
const ended = await client.processes.wait("shop-web-1", started.processId, { started: started.started, timeout: 600 });
console.log(ended.exitCode);
for await (const line of client.processes.logs("shop-web-1", started.processId)) {
	console.log(line.stream, line.line);
}
```

### Copy files in and out

Paths in a machine are Windows paths, written `C:/data` or `C:\data`.

```js
await client.archives.copyIn("shop-web-1", "./seed", "C:/data");               // C:\data\seed
await client.archives.copyOut("shop-web-1", "C:/results/report.xml", "./out");   // ./out/report.xml
```

### Drive the desktop

An element is named by a path of segments separated by `/`. A segment names a control type, a name in brackets, an automation ID after `#`, or several of these, such as `Window[Ledger]/Edit#CustomerName`. The first segment always names one of the program's top-level windows.

```js
const app = await client.desktop.launch("shop-web-1", { program: "C:\\apps\\Ledger\\Ledger.exe" });
const target = { processId: app.processId, started: app.started };
await client.desktop.wait("shop-web-1", { ...target, element: "Window[Ledger]/Edit#CustomerName", timeoutSeconds: 120 });
await client.desktop.setValue("shop-web-1", { ...target, element: "Window[Ledger]/Edit#CustomerName", value: "Ada" });
await client.desktop.invoke("shop-web-1", { ...target, element: "Window[Ledger]/Button[Save]" });
const picture = await client.desktop.screenshot("shop-web-1");                  // picture.png holds the PNG bytes
```

### The other route groups

`machines` lists, inspects, starts, stops and restarts machines and reads their logs; `volumes` lists, inspects and removes named volumes; `bases` imports Windows disks as images; `stats` reads processor and memory readings; `system` reads disk use, the build cache's included, and prunes; `certificates` issues and revokes client certificates, on the named pipe only. Each method's declaration documents its options.

### Follow long work

The service runs builds, imports, prunes, and fleet and machine starts, stops and restarts in the background, as operations. Every method that starts one returns an `OperationHandle`. `cancel` asks the service to stop the work. `wait` gives the finished operation whatever its outcome; `result` gives its result or throws. `operations.handle` wraps an operation that another program started, so that this program can wait for it too:

```js
for (const running of await client.operations.list({ filters: { state: ["running"], kind: ["build"] } })) {
	const finished = await client.operations.handle(running).wait();   // state: succeeded, failed, cancelled or interrupted
	console.log(finished.target, finished.state);
}
```

### Errors

Every call reports a failure as one of two errors:

```js
import { EastIndiaApiError, EastIndiaConnectionError } from "endia";

try {
	await client.images.inspect("lab/ledger:1");
}
catch (error) {
	if (error instanceof EastIndiaApiError) {
		// The service answered and refused, or an operation ended without succeeding:
		// error.code, such as "NOT_FOUND" or "BUILD_FAILED"; error.status, such as 404; error.fieldPath;
		// error.error, the service's whole error, whose details hold the code's own data
	}
	else if (error instanceof EastIndiaConnectionError) {
		// No answer came: error.failure is "unreachable", "certificateRefused", "serverNotTrusted", "pipeRefused" or "timedOut"
	}
}
```

## Folders

| Source folder or file | What it holds |
|---|---|
| `src/endia.ts` | `EastIndiaClient`, where a caller starts, with `fromEnv` |
| `src/environment.ts` | the CLI's rule for choosing the connection from the environment, `config.json` and the stored contexts |
| `src/compose-model.ts` | `resolveComposeModel`, which runs `endia compose config --format json` |
| `src/errors.ts` | `EastIndiaApiError` and `EastIndiaConnectionError` |
| `src/routes.ts` | the paths of the API's routes and the headers it defines |
| `src/groups/` | one client per route group: images, bases, operations, fleets, machines, volumes, execs, archives, processes, desktop, stats, system, certificates |
| `src/transport/` | the one connection the groups share: the address forms, the retries and idempotency keys, the reading of refusals, the query strings and the line-by-line JSON streams |
| `src/exec/` | the multiplexed frame format and `ExecSession`, an attached program's streams |
| `src/archives/` | the tar archives the client sends: a build context with its ignore file, and a fleet's archive |
| `src/contract/` | the API's requests and answers as TypeScript interfaces |
| `test/unit/`, `test/integration/`, `test/live/` | the tests: rules of single parts; the client against a fake service; the client against the real service |
| `test/support/`, `test/fixtures/` | the fake service, the test certificates and the example ignore file |

## What it does not do

* It reads no Compose file. `fleets.up` takes the resolved model; `resolveComposeModel` asks the CLI for it.
* `fleets.up` returns once the service has accepted the work, and its result comes once the machines are ready. It does not follow the machines' logs, as `endia compose up` without `-d` does; `machines.logs` gives them.
* `archives.copyIn` and `archives.copyOut` place a copy inside an existing folder under its own name. The other placements of `docker cp`, such as a copy under a new name, are available through `archives.read` and `archives.write` with the caller's own archives.
* It removes no machine on its own: the API creates and removes machines only with their fleet.
* It never consults the operating system's trust stores, and server verification cannot be turned off.

## Reference

* **Server trust.** Over HTTPS the client presents the caller's certificate, and accepts the server only when the server's certificate chains to `ca.pem`, is meant for server authentication and names the address the client connects to.
* **Retries.** A request that changes something carries a new `Idempotency-Key` of 32 lower-case hexadecimal digits. When its connection fails before any reply, it is sent again with the same key, up to `requestRetries` times (2 by default), `requestRetryDelayMilliseconds` apart (1000 by default), so that the service does the work once. A read is not sent again.
* **Requests sent once.** `bases.prepare`, `desktop.answerPrompt`, `desktop.setValue` with `secret: true` and `certificates.issue` are sent once, with no `Idempotency-Key`, no retry and no time limit of the client's own. The first three carry a password; the answer to the last carries a private key. `desktop.screenshot` carries no key, because it changes nothing.
* **Time limit.** `requestTimeoutMilliseconds` (100 seconds by default) applies to every request except an upload (a build context or a fleet's archive), a streamed answer (a log or readings), a process wait or stop, a desktop wait, and a request sent once. A request that outlasts it fails with `EastIndiaConnectionError` and `failure: "timedOut"`. A caller's own `signal` cancels any request; the call then rejects with the signal's reason.
* **Telling failures apart.** A server certificate the client refused is `serverNotTrusted`. The service refuses a client certificate that another authority issued, that has expired or that was revoked; it ends the handshake with a TLS alert, which the client reports as `certificateRefused`. Windows refusing the named pipe is `pipeRefused`. Anything else is `unreachable`, whose message is `Cannot connect to the EastIndia service at <address>. Is the service running?`.
* **Refusals without a body.** A refused HEAD, such as `archives.stat`, carries its error in the `X-EastIndia-Error` header. A refused WebSocket upgrade carries it in the body of the upgrade's answer.
* **Operations.** `wait` follows the operation's log to its end, then reads the operation. When the log ends before the operation has finished, as when a connection breaks, it opens the log again after one second and skips the text `onLog` already received. `result` throws `EastIndiaApiError` with `status` undefined and the operation's error, such as `BUILD_FAILED` or `CANCELLED`.
* **Exec.** An attached exec runs over the WebSocket `GET /v1/execs/{id}/start`. Without a console, each message is one frame in Docker's multiplexed format: byte 0 is the stream (0 standard input, 1 standard output, 2 standard error), bytes 1 to 3 are zero, and bytes 4 to 7 are the payload's length as a big-endian integer. An empty standard-input frame closes the program's standard input. With a console, messages carry raw bytes. The exit code is read from `GET /v1/execs/{id}` once the service closes the WebSocket: 127 when the program was not found, 126 when it was found but could not start, and null when Windows restarted before it ended.
* **Times.** Times stay RFC 3339 strings with seven fractional digits, such as `2026-10-05T14:03:22.1234567Z`. A JavaScript `Date` keeps only milliseconds, while the process routes compare a `started` value to the seventh digit. The client therefore keeps each time as the text the service wrote, and the caller sends a `started` value back as it was read.
* **Build contexts.** Without a recipe named, a build reads `Endiafile` in the context folder when it exists, and `Dockerfile` otherwise. The ignore file lists the files a build leaves out of the archive it sends. It is the first that exists of `<recipe file name>.endiaignore` and `<recipe file name>.dockerignore` beside the recipe, and then `.endiaignore` and `.dockerignore` at the root of the context. A fleet's build contexts follow the same rules. Patterns are cleaned and anchored at the root; `*` and `?` stop at `/`, `**` spans folders, `[...]` is a character class, `!` re-includes, and a later line overrides an earlier one. The recipe and the ignore file are always sent, and a link is archived as a link. A recipe outside the folder is added at the archive's root as `.dockerfile.` followed by 16 random hexadecimal digits. When the ignore file has a `!` line, the client also looks inside each folder the file leaves out, so that a file the `!` line re-includes is sent.
* **Fleet archive.** `fleets.up` sends one tar archive: `compose.json`, the resolved model as given; `contexts/<service>/`, the build context of each selected service that has `build`; and `binds/<service>/<index>`, the source of each bind mount, by the index of its entry in the service's `volumes`. When a purpose is given the archive also holds `purpose.json`, the title and detail. The service accepts only files and folders in this archive, so a link is sent as what it points at; a link to a folder inside a build context arrives as an empty folder. The fleet's name is the model's `name`.
* **Named pipe.** On Windows the client opens `\\.\pipe\<name>` through `node:http`. The tests exercise the same code through a Unix socket.
* **Packages.** `ws` 8.22.1 (MIT) carries the exec WebSocket with the same certificate files as every request. `tar` 7.5.22 (BlueOak-1.0.0) writes and extracts the tar archives. The ignore-file matcher is the package's own, because no package implements Docker's rules. Development only: `typescript` 6.0.3 (Apache-2.0), `eslint` 10.14.0, `typescript-eslint` 8.72.1, `@eslint/js` 10.0.1, `@types/node` 20.19.43 and `@types/ws` 8.18.2 (all MIT).
* **Version.** The package has its own version, `version` in `package.json`, separate from the EastIndia service's. Multi-stage builds (`target`, `stages`) and `pruneBuildCache` need EastIndia 0.16.82 or later.
* **Tests.** `npm ci` installs the locked packages. `npm test` type-checks, runs ESLint with every warning an error, and runs the unit tests and the integration tests against a fake service. `EASTINDIA_LIVE=1 EASTINDIA_CLI=<path of endia> npm run test:live` runs the live tests against the CLI's current context; they name everything they create `sdk-node-` and remove it afterwards.
