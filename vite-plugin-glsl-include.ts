import { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

function processIncludes(source: string, dir: string, seen: Set<string> = new Set(), context: {addWatchFile: (id: string) => void}): string {
  return source.replace(/#include\s+"(.+?)"/g, (_, includePath) => {
    const fullPath = path.resolve(dir, includePath);

    if (seen.has(fullPath)) {
      return ""
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Included file not found: ${fullPath}`);
    }

    context.addWatchFile(fullPath);
    seen.add(fullPath);
    const includedSource = fs.readFileSync(fullPath, 'utf8');
    const processed = processIncludes(includedSource, path.dirname(fullPath), seen, context);
    return processed;
  });
}

export default function glslIncludePlugin(): Plugin {
  return {
    name: 'vite-plugin-glsl-include',
    enforce: 'pre',
    transform(src, id) {
      if (id.endsWith('.vert') || id.endsWith('.frag') || id.endsWith(".vs") || id.endsWith(".fs") || id.endsWith(".glsl")) {
        const dir = path.dirname(id);
        const processed = processIncludes(src, dir, new Set(), this);
        return {
          code: `export default ${JSON.stringify(processed)};`,
          map: null,
        };
      }
    },
  };
}
