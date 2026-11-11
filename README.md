# endia

Client for EastIndia, which runs Windows desktop test machines that tests drive like Docker containers. Early preview: the product is not released yet.

The package needs Node 20 or later and ships ES modules with TypeScript declarations. It calls the EastIndia service's HTTPS API, so a Node test runner can build images, bring fleets of machines up and down, and run programs in them without the `endia` command line.

## Example

`ledger/Endiafile` holds a recipe of two stages; each stage begins with a `FROM`, and `AS` names it:

```dockerfile
FROM eastindia/development:latest AS tools
RUN choco install -y git

FROM tools AS app
COPY publish/ C:/app/
```

```js
import { EastIndiaClient } from "endia";

// Connects where the endia command line would: EASTINDIA_HOST and EASTINDIA_CERT_PATH, or its current context.
const client = EastIndiaClient.fromEnv();
console.log((await client.version()).version);

const build = await client.images.build({ folder: "./ledger" }, { tags: ["lab/ledger:1"] });
const built = await build.result({ onLog: (text) => process.stdout.write(text) });
console.log(built.digest);

// A recipe of several stages: target names the stage to build, here the first.
const tools = await (await client.images.build({ folder: "./ledger" }, { target: "tools", tags: ["lab/tools:1"] })).result();
console.log(tools.stages?.map((stage) => [stage.name, stage.cacheHit]));

client.close();
```
