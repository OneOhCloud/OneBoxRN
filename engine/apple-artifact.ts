export const REQUIRED_LIBBOX_SLICES = [
  "ios-arm64",
  "ios-arm64_x86_64-simulator",
] as const;

const GENERATED_HEADERS = [
  "Libbox.objc.h",
  "Universe.objc.h",
  "ref.h",
] as const;

export interface LandingPair {
  staged: string;
  landed: string;
}

export class LandingRollbackError extends Error {}

function run(command: string, args: string[], cwd?: string): void {
  const result = new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(
      `command failed (${result.code}): ${command} ${
        args.join(" ")
      }\n${stderr}`,
    );
  }
}

function capture(command: string, args: string[]): string {
  const result = new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(
      `command failed (${result.code}): ${command} ${
        args.join(" ")
      }\n${stderr}`,
    );
  }
  return new TextDecoder().decode(result.stdout);
}

function fileExists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

export function assertHeadersMatch(
  deviceHeaders: string,
  simulatorHeaders: string,
  headers: readonly string[] = GENERATED_HEADERS,
): void {
  for (const header of headers) {
    const device = Deno.readFileSync(`${deviceHeaders}/${header}`);
    const simulator = Deno.readFileSync(`${simulatorHeaders}/${header}`);
    if (!equalBytes(device, simulator)) {
      throw new Error(`${header} header differs between slices`);
    }
  }
}

export function assertLibboxAnchor(nmOutput: string, archive: string): void {
  const exported = nmOutput.split("\n").some((line) =>
    /(?:^|\s)T\s+_LibboxVersion(?:\s|$)/.test(line)
  );
  if (!exported) {
    throw new Error(`${archive} does not export _LibboxVersion`);
  }
}

export function assertArchitectures(
  lipoOutput: string,
  expectedArchitectures: readonly string[],
  archive: string,
): void {
  const present = [...new Set(lipoOutput.trim().split(/\s+/).filter(Boolean))]
    .sort();
  const expected = [...expectedArchitectures].sort();
  if (present.join("\n") !== expected.join("\n")) {
    throw new Error(
      `${archive} architectures [${present.join(",")}] != expected [${
        expected.join(",")
      }]`,
    );
  }
}

export function parseLibraryIdentifiers(plistJson: string): string[] {
  const value: unknown = JSON.parse(plistJson);
  if (typeof value !== "object" || value === null) {
    throw new Error("xcframework Info.plist is not a dictionary");
  }
  const libraries = (value as Record<string, unknown>).AvailableLibraries;
  if (!Array.isArray(libraries)) {
    throw new Error("xcframework Info.plist lacks AvailableLibraries");
  }
  const identifiers = libraries.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`AvailableLibraries[${index}] is not a dictionary`);
    }
    const identifier = (entry as Record<string, unknown>).LibraryIdentifier;
    if (typeof identifier !== "string") {
      throw new Error(
        `AvailableLibraries[${index}].LibraryIdentifier is not a string`,
      );
    }
    return identifier;
  }).sort();
  const expected = [...REQUIRED_LIBBOX_SLICES].sort();
  if (identifiers.join("\n") !== expected.join("\n")) {
    throw new Error(
      `xcframework slices [${identifiers.join(",")}] != required [${
        expected.join(",")
      }]`,
    );
  }
  return identifiers;
}

export function commitLanding(
  pairs: readonly LandingPair[],
  backupDirectory: string,
): void {
  Deno.mkdirSync(backupDirectory, { recursive: true });
  const backups: LandingPair[] = [];
  const placed: LandingPair[] = [];
  try {
    for (const [index, pair] of pairs.entries()) {
      if (!fileExists(pair.landed)) continue;
      const backup = `${backupDirectory}/${index}`;
      Deno.renameSync(pair.landed, backup);
      backups.push({ staged: backup, landed: pair.landed });
    }
    for (const pair of pairs) {
      Deno.renameSync(pair.staged, pair.landed);
      placed.push(pair);
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const pair of [...placed].reverse()) {
      try {
        if (fileExists(pair.landed)) Deno.renameSync(pair.landed, pair.staged);
      } catch (rollbackError) {
        rollbackFailures.push(`un-place ${pair.landed}: ${rollbackError}`);
      }
    }
    for (const backup of [...backups].reverse()) {
      try {
        if (fileExists(backup.staged)) {
          Deno.renameSync(backup.staged, backup.landed);
        }
      } catch (rollbackError) {
        rollbackFailures.push(
          `restore ${backup.landed} from ${backup.staged}: ${rollbackError}`,
        );
      }
    }
    if (rollbackFailures.length > 0) {
      throw new LandingRollbackError(
        `landing failed (${error}); rollback failed; recover from ${backupDirectory}: ${
          rollbackFailures.join("; ")
        }`,
      );
    }
    throw error;
  }
}

function frameworkPaths(
  source: string,
  slice: string,
): { archive: string; headers: string } {
  const framework = `${source}/${slice}/Libbox.framework`;
  return {
    archive: Deno.realPathSync(`${framework}/Libbox`),
    headers: Deno.realPathSync(`${framework}/Headers`),
  };
}

function assertArchiveArchitectures(
  archive: string,
  expectedArchitectures: readonly string[],
): void {
  assertArchitectures(
    capture("xcrun", ["lipo", "-archs", archive]),
    expectedArchitectures,
    archive,
  );
  for (const architecture of expectedArchitectures) {
    assertLibboxAnchor(
      capture("xcrun", ["nm", "-g", "-arch", architecture, archive]),
      `${archive} (${architecture})`,
    );
  }
}

function copyHeaders(source: string, destination: string): void {
  Deno.mkdirSync(destination, { recursive: true });
  for (const header of GENERATED_HEADERS) {
    Deno.copyFileSync(`${source}/${header}`, `${destination}/${header}`);
  }
}

export function stageStaticLibrary(
  sourceArchive: string,
  destinationDirectory: string,
): string {
  Deno.mkdirSync(destinationDirectory, { recursive: true });
  const stagedArchive = `${destinationDirectory}/libEngineFFI.a`;
  Deno.copyFileSync(sourceArchive, stagedArchive);
  return stagedArchive;
}

export function packageDynamicEngine(
  sourcePath: string,
  packagePath: string,
): void {
  const source = Deno.realPathSync(sourcePath);
  const packageDirectory = Deno.realPathSync(packagePath);
  const device = frameworkPaths(source, REQUIRED_LIBBOX_SLICES[0]);
  const simulator = frameworkPaths(source, REQUIRED_LIBBOX_SLICES[1]);
  assertHeadersMatch(device.headers, simulator.headers);
  assertArchiveArchitectures(device.archive, ["arm64"]);
  assertArchiveArchitectures(simulator.archive, ["arm64", "x86_64"]);

  const stage = Deno.makeTempDirSync({
    dir: packageDirectory,
    prefix: ".engine-link-",
  });
  const outputFramework = `${stage}/EngineLink.xcframework`;
  const outputHeaders = `${stage}/include`;
  const existingHeaders = `${packageDirectory}/Sources/EngineKit/include`;

  try {
    copyHeaders(device.headers, outputHeaders);
    Deno.copyFileSync(
      `${existingHeaders}/EngineKit.h`,
      `${outputHeaders}/EngineKit.h`,
    );
    Deno.writeTextFileSync(
      `${outputHeaders}/EngineFFI.h`,
      '#pragma once\n#import "ref.h"\n#import "Libbox.objc.h"\n#import "Universe.objc.h"\n',
    );
    const deviceArchive = stageStaticLibrary(
      device.archive,
      `${stage}/device`,
    );
    const simulatorArchive = stageStaticLibrary(
      simulator.archive,
      `${stage}/simulator`,
    );

    run("xcodebuild", [
      "-create-xcframework",
      "-library",
      deviceArchive,
      "-library",
      simulatorArchive,
      "-output",
      outputFramework,
    ]);
    const plist = capture("plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      `${outputFramework}/Info.plist`,
    ]);
    parseLibraryIdentifiers(plist);

    commitLanding(
      [
        {
          staged: outputFramework,
          landed: `${packageDirectory}/EngineLink.xcframework`,
        },
        {
          staged: outputHeaders,
          landed: `${packageDirectory}/Sources/EngineKit/include`,
        },
      ],
      `${stage}/backup`,
    );
  } catch (error) {
    if (error instanceof LandingRollbackError) throw error;
    Deno.removeSync(stage, { recursive: true });
    throw error;
  }
  Deno.removeSync(stage, { recursive: true });
}

if (import.meta.main) {
  const [command, source, packageDirectory] = Deno.args;
  if (command !== "package-dynamic-engine" || !source || !packageDirectory) {
    console.error(
      "usage: apple-artifact.ts package-dynamic-engine <Engine.xcframework> <EngineKit package>",
    );
    Deno.exit(2);
  }
  packageDynamicEngine(source, packageDirectory);
  console.log(`[engine] packaged shared Apple framework: ${packageDirectory}`);
}
