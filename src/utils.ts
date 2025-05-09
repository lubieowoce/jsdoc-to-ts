export function findTagSourceLine(lines: { source: string }[], tag: string) {
  const prefix = `@${tag} `;
  return lines.find((line) => line.source.includes(prefix));
}

export function getTagContentsFromRawSource(line: string, tag: string) {
  const pattern = new RegExp(String.raw`@${tag}\s*(.+?)\s*(?:\*/)?\s*$`);
  const match = line.match(pattern);

  if (!match) return null;
  return match[1];
}
