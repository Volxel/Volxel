import { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

function processIncludes(source: string, dir: string, seen: Set<string> = new Set()): string {
  return source.replace(/#include\s+"(.+?)"/g, (_, includePath) => {
    const fullPath = path.resolve(dir, includePath);

    if (seen.has(fullPath)) {
      throw new Error(`Circular include detected: ${fullPath}`);
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Included file not found: ${fullPath}`);
    }

    seen.add(fullPath);
    const includedSource = fs.readFileSync(fullPath, 'utf8');
    const processed = processIncludes(includedSource, path.dirname(fullPath), seen);
    seen.delete(fullPath);
    return processed;
  });
}

export default function glslIncludePlugin(): Plugin {
  return {
    name: 'vite-plugin-glsl-include',
    enforce: 'pre',
    transform(src, id) {
      if (id.endsWith('.vert') || id.endsWith('.frag')) {
        const dir = path.dirname(id);
        const processed = processIncludes(src, dir);
        return {
          code: `export default ${JSON.stringify(processed)};`,
          map: null,
        };
      }
    },
  };
}
