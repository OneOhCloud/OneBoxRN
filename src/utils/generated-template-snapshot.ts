export function canReuseGeneratedTemplateSnapshot(
    snapshot: string,
    expectedBranch: string,
    expectedSingBoxVersion: string,
): boolean {
    const branch = /^\/\/ Branch:\s+(.+)$/m.exec(snapshot)?.[1]?.trim();
    const singBoxVersion = /^\/\/ sing-box:\s+(v?[^\s]+)/m.exec(snapshot)?.[1];
    return branch === expectedBranch && singBoxVersion === expectedSingBoxVersion;
}
