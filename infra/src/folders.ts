import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';
import type { AppEnvironmentPair, Environment } from './model.ts';

/**
 * The folder hierarchy.
 *
 *   <delegation folder>/
 *   ├── shared/                      the central project
 *   └── environments/
 *       ├── production/apps/<app>/
 *       └── staging/apps/<app>/
 *
 * Environment-major on purpose. A single `production` folder means a new app cannot
 * land in production without inheriting whatever policy sits there — inheritance is
 * fail-closed this way round. App-major would make per-app delegation one grant
 * instead of two, at the cost of an app nobody remembered to stamp inheriting nothing.
 */

const config = new pulumi.Config();

/** Folder the bootstrap stack delegates to this one, as `folders/<id>`. */
const delegationFolder = config.require('delegationFolder');

/**
 * Adoption identifiers for folders that predate this program go here, keyed by
 * resource name, and are removed once an `up` has taken them. Empty means the tree is
 * fully owned.
 */
const ADOPT: Readonly<Record<string, string>> = {};

const adopt = (name: string): pulumi.CustomResourceOptions => {
  const id = ADOPT[name];
  return id === undefined ? {} : { import: id };
};

const folder = (
  name: string,
  displayName: string,
  parent: pulumi.Input<string>,
  options: pulumi.CustomResourceOptions = {},
) => new gcp.organizations.Folder(name, { displayName, parent }, { ...options, ...adopt(name) });

/** Holds the central project: shared state and registries, nothing app-specific. */
export const sharedFolder = folder('shared', 'shared', delegationFolder);

const environmentsFolder = folder('environments', 'environments', delegationFolder);

/**
 * An environment's folder, and the `apps` folder inside it, which is where app folders go. Room is
 * left beside `apps` for anything that is environment-scoped but not an app.
 */
const environmentAppsFolder = (environment: Environment): gcp.organizations.Folder => {
  const environmentFolder = folder(environment, environment, environmentsFolder.name);

  return folder(`${environment}-apps`, 'apps', environmentFolder.name);
};

/** Written out rather than iterated, and typed so an environment added to the model is missed loudly. */
const appsFolders: Readonly<Record<Environment, gcp.organizations.Folder>> = {
  production: environmentAppsFolder('production'),
  staging: environmentAppsFolder('staging'),
};

/**
 * One folder per app per environment. This is the unit delegated to an app: it holds
 * that app's project, and an app may create further projects of its own beside it.
 */
export const appFolder = (
  { app, environment, key }: AppEnvironmentPair,
  options: pulumi.CustomResourceOptions,
): gcp.organizations.Folder => folder(key, app, appsFolders[environment].name, options);
