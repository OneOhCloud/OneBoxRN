// 仓根定位的唯一实现。商店构建管线的各模块都据它拼路径；各写一份就会在目录挪动时各自漂移。

const scriptDir = import.meta.dirname;
if (!scriptDir) throw new Error("cannot resolve script dir");

export const repoRoot = Deno.realPathSync(`${scriptDir}/../..`);
