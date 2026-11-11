import { mkdir, mkdtemp, rm, writeFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "shtora-d1-consumer-"));
const consumer = join(temp, "consumer");
const npmCli =
  process.platform !== "win32"
    ? null
    : basename(process.env.npm_execpath ?? "").toLowerCase() === "npm-cli.js"
      ? process.env.npm_execpath
      : join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npm = process.platform === "win32" ? process.execPath : "npm";
const npmArgs = npmCli === null ? [] : [npmCli];
const workersTypesVersion = "5.20261110.1";
const compilers = [
  { alias: "typescript56", version: "5.6.3" },
  { alias: "typescript7", version: "7.0.2" },
];

function run(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      [
        `${executable} exited with status ${result.status ?? "unknown"}.`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result.stdout;
}

try {
  const packOutput = run(
    npm,
    [...npmArgs, "pack", "--json", "--pack-destination", temp],
    root,
  );
  const [packed] = JSON.parse(packOutput);
  if (!packed?.filename) throw new Error("npm pack did not report a tarball.");

  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await copyFile(
    join(root, "tests", "consumer", "usage.ts"),
    join(consumer, "usage.ts"),
  );
  await copyFile(
    join(root, "tests", "consumer", "tsconfig.json"),
    join(consumer, "tsconfig.json"),
  );

  const packages = [
    join(temp, packed.filename),
    `@cloudflare/workers-types@${workersTypesVersion}`,
    ...compilers.map(({ alias, version }) => `${alias}@npm:typescript@${version}`),
  ];
  run(
    npm,
    [
      ...npmArgs,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-save",
      "--package-lock=false",
      ...packages,
    ],
    consumer,
  );

  for (const { alias, version } of compilers) {
    run(
      process.execPath,
      [
        join(consumer, "node_modules", alias, "bin", "tsc"),
        "--project",
        join(consumer, "tsconfig.json"),
      ],
      consumer,
    );
    console.log(`Packed consumer typecheck passed with TypeScript ${version}.`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
