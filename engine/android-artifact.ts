const BROAD_CONSUMER_RULE = "-keep class cloud.oneoh.** { *; }";
const BINDING_CONSUMER_RULE = "-keep class cloud.oneoh.libbox.** { *; }";

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

function parentDirectory(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator < 0 ? "." : path.slice(0, separator) || "/";
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

// gomobile 会按宽泛 Java 包前缀生成规则；重打 AAR 后只保留 JNI 反射绑定，
// 避免整个应用命名空间都绕过 R8。
export function narrowLibboxConsumerRules(rules: string): string {
  const occurrences = rules.split(BROAD_CONSUMER_RULE).length - 1;
  if (occurrences === 0 && rules.includes(BINDING_CONSUMER_RULE)) return rules;
  if (occurrences !== 1) {
    throw new Error(
      `expected one broad consumer rule, found ${occurrences}; broad consumer rule not found or duplicated`,
    );
  }
  return rules.replace(BROAD_CONSUMER_RULE, BINDING_CONSUMER_RULE);
}

export function optimizeLibboxAar(
  candidatePath: string,
  landingPath: string,
): void {
  const candidate = Deno.realPathSync(candidatePath);
  const landingDirectory = Deno.realPathSync(parentDirectory(landingPath));
  const work = Deno.makeTempDirSync({
    dir: landingDirectory,
    prefix: ".engine-aar-",
  });
  const contents = `${work}/contents`;
  const optimized = `${work}/optimized.aar`;

  try {
    Deno.mkdirSync(contents);
    run("unzip", ["-q", candidate, "-d", contents]);
    const rules = `${contents}/proguard.txt`;
    if (!fileExists(rules)) {
      throw new Error(`${candidate} does not contain proguard.txt`);
    }
    const optimizedRules = narrowLibboxConsumerRules(
      Deno.readTextFileSync(rules),
    );
    Deno.writeTextFileSync(rules, optimizedRules);
    run("zip", ["-q", "-r", optimized, "."], contents);

    const packedRules = capture("unzip", ["-p", optimized, "proguard.txt"]);
    if (packedRules !== optimizedRules) {
      throw new Error(`failed to replace consumer rules in ${candidate}`);
    }

    // 工作目录与正式 AAR 同级，校验完成前不会触碰已有交付产物。
    Deno.renameSync(optimized, landingPath);
  } finally {
    Deno.removeSync(work, { recursive: true });
  }
}

if (import.meta.main) {
  const [command, candidate, landing] = Deno.args;
  if (
    command !== "optimize-libbox-aar" || !candidate || !landing ||
    Deno.args.length !== 3
  ) {
    console.error(
      "usage: android-artifact.ts optimize-libbox-aar <candidate.aar> <landing.aar>",
    );
    Deno.exit(2);
  }
  optimizeLibboxAar(candidate, landing);
  console.log(`[libbox] validated and landed optimized AAR: ${landing}`);
}
