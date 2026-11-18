import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LEGACY_ID_CONFIGURATION } from '../../src/core/id-configuration';

/** A project without `.specular/project.json` recognizes no IDs; fixtures written for REQ/DD-style IDs opt into the legacy rules. A configuration the test already wrote is kept. */
export async function seedLegacyConfiguration(project: string) {
  await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(LEGACY_ID_CONFIGURATION), { flag: 'wx' })
    .catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
}
