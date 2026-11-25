export function isSkillManifest(path: string) {
  return /(?:^|\/)SKILL\.md$/i.test(path);
}

export function isSkillReference(path: string) {
  return path.startsWith('references/') ? /\.(?:md|txt|json|yaml|yml|csv)$/i.test(path)
    : !path.includes('/') && !isSkillManifest(path) && /\.(md|txt)$/i.test(path);
}

function parentOf(path: string) {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? '' : path.slice(0, separator);
}

export function pathInsideSkill(folder: string, path: string) {
  return path.slice(folder ? folder.length + 1 : 0);
}

export function groupSkillPaths(paths: string[]) {
  const groups = new Map<string, { folder: string; manifests: string[]; references: string[] }>();
  for (const path of paths) {
    if (!isSkillManifest(path)) continue;
    const folder = parentOf(path);
    const group = groups.get(folder) ?? { folder, manifests: [], references: [] };
    group.manifests.push(path);
    groups.set(folder, group);
  }
  for (const path of paths) {
    if (isSkillManifest(path)) continue;
    let folder = parentOf(path);
    for (;;) {
      const group = groups.get(folder);
      if (group) {
        if (isSkillReference(pathInsideSkill(folder, path))) group.references.push(path);
        break;
      }
      if (!folder) break;
      folder = parentOf(folder);
    }
  }
  return [...groups.values()];
}
