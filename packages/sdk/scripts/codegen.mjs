// Generates Kit-native clients for the Opaq programs from their Anchor IDLs.
// Run `anchor build` at the repo root first so target/idl is up to date.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
import { createFromRoot } from 'codama';

const packageFolder = join(dirname(fileURLToPath(import.meta.url)), '..');
const idlFolder = join(packageFolder, '..', '..', 'target', 'idl');

const programs = [
  { idl: 'opaq_registry.json', folder: 'src/generated/registry' },
  { idl: 'opaq_vault.json', folder: 'src/generated/vault' },
];

for (const { idl, folder } of programs) {
  const anchorIdl = JSON.parse(readFileSync(join(idlFolder, idl), 'utf8'));
  const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));
  await codama.accept(
    renderVisitor(packageFolder, {
      generatedFolder: folder,
      importExtension: 'js',
      syncPackageJson: false,
      deleteFolderBeforeRendering: true,
    }),
  );
  console.log(`Generated ${folder} from ${idl}`);
}
