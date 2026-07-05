import { readFileSync, existsSync, statSync } from "fs";
import { resolve } from "path";

// charter 소스 해석 (I/O). v1: 로컬 파일 경로 또는 --registry 디렉터리 ref.
// 원격 URL / awesome-loops ref 는 Ship 2b — 인터페이스만 두고 지금은 throw.

export interface ResolvedCharter {
  raw: string;
  origin: string;
}

interface RegistryIndex {
  charters?: { name: string; file: string; description?: string }[];
}

export function resolveCharter(source: string, opts: { registry?: string } = {}): ResolvedCharter {
  const asPath = resolve(process.cwd(), source);
  if (existsSync(asPath) && statSync(asPath).isFile()) {
    return { raw: readFileSync(asPath, "utf8"), origin: asPath };
  }

  if (/^https?:\/\//.test(source)) {
    throw new Error(`remote fetch is not supported yet (Ship 2b): ${source}`);
  }

  if (!opts.registry) {
    throw new Error(`"${source}" is not a file and no --registry was given`);
  }

  const indexPath = resolve(process.cwd(), opts.registry, "index.json");
  if (!existsSync(indexPath)) {
    throw new Error(`registry index not found: ${indexPath}`);
  }
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as RegistryIndex;
  const entry = index.charters?.find((c) => c.name === source);
  if (!entry) {
    throw new Error(`charter "${source}" not found in registry ${opts.registry}`);
  }
  const file = resolve(process.cwd(), opts.registry, entry.file);
  return { raw: readFileSync(file, "utf8"), origin: `${opts.registry}:${entry.name}` };
}
